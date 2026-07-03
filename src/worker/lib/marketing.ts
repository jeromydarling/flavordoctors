import type { Env } from '../types';
import { sendEmail } from './email';
import { bytesToBase64Url } from './util';

export interface ContactRow {
  email: string;
  user_id: string | null;
  source: string;
  marketing_consent: number;
  unsub_token: string;
  ref_code: string | null;
  referred_by: string | null;
  utm_json: string | null;
  created_at: string;
}

export function newToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

export function newRefCode(): string {
  // Short, human-shareable, unambiguous.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Upsert a contact (never downgrades consent; keeps first source & referrer). */
export async function upsertContact(
  env: Env,
  email: string,
  opts: { userId?: string; source?: string; referredBy?: string; utm?: Record<string, string> } = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO contacts (email, user_id, source, unsub_token, ref_code, referred_by, utm_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET user_id = COALESCE(contacts.user_id, excluded.user_id)`
  )
    .bind(
      email.toLowerCase(),
      opts.userId ?? null,
      opts.source ?? 'unknown',
      newToken(),
      newRefCode(),
      opts.referredBy ?? null,
      opts.utm ? JSON.stringify(opts.utm) : null
    )
    .run();
}

/**
 * Audience segments, each resolving to consented contact emails.
 * All queries return a single `email` column.
 */
export const SEGMENTS: Record<string, { name: string; sql: string }> = {
  all_contacts: {
    name: 'All consented contacts',
    sql: `SELECT email FROM contacts WHERE marketing_consent = 1`,
  },
  waitlist: {
    name: 'Waitlist (landing-page signups)',
    sql: `SELECT email FROM contacts WHERE marketing_consent = 1 AND (source LIKE 'landing:%' OR source = 'waitlist')`,
  },
  customers: {
    name: 'Customers (any paid order)',
    sql: `SELECT c.email FROM contacts c WHERE c.marketing_consent = 1 AND EXISTS (SELECT 1 FROM orders o WHERE o.email = c.email AND o.status != 'canceled')`,
  },
  never_purchased: {
    name: 'Contacts who never purchased',
    sql: `SELECT c.email FROM contacts c WHERE c.marketing_consent = 1 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.email = c.email)`,
  },
  subscribers_active: {
    name: 'Active/paused subscribers',
    sql: `SELECT c.email FROM contacts c JOIN users u ON u.email = c.email JOIN subscriptions s ON s.user_id = u.id
          WHERE c.marketing_consent = 1 AND s.status IN ('active', 'past_due', 'paused')`,
  },
  subscribers_canceled: {
    name: 'Canceled subscribers',
    sql: `SELECT c.email FROM contacts c JOIN users u ON u.email = c.email
          WHERE c.marketing_consent = 1
            AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'canceled')
            AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'past_due', 'paused'))`,
  },
  lapsed_30d: {
    name: 'Customers with no order in 30+ days',
    sql: `SELECT c.email FROM contacts c WHERE c.marketing_consent = 1
            AND EXISTS (SELECT 1 FROM orders o WHERE o.email = c.email)
            AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.email = c.email AND o2.created_at > datetime('now', '-30 days'))`,
  },
};

export async function segmentEmails(env: Env, segment: string, limit = 900): Promise<string[]> {
  const def = SEGMENTS[segment];
  if (!def) return [];
  const { results } = await env.DB.prepare(`${def.sql} LIMIT ?`).bind(limit).all<{ email: string }>();
  return results.map((r) => r.email);
}

/** Rewrite links for click tracking and append an open pixel. */
export function instrumentHtml(html: string, origin: string, campaignId: string, email: string): string {
  const e = encodeURIComponent(email);
  const withClicks = html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url: string) => {
    return `href="${origin}/t/c?c=${campaignId}&e=${e}&u=${encodeURIComponent(url)}"`;
  });
  return `${withClicks}<img src="${origin}/t/o?c=${campaignId}&e=${e}" width="1" height="1" alt="" style="display:none">`;
}

const MARKETING_WRAPPER = (inner: string, unsubUrl: string, address: string) => `
<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; border: 2px solid #0D1B2A; border-radius: 8px; overflow: hidden;">
  <div style="background: #0D1B2A; color: #F5F5F5; padding: 20px 28px;">
    <span style="font-size: 26px; font-weight: bold;">℞ Flavor Doctors</span>
  </div>
  <div style="padding: 28px; background: #F5F5F5; color: #0D1B2A; font-size: 16px; line-height: 1.6;">
    ${inner}
  </div>
  <div style="background: #0D1B2A; color: #9aa7b5; padding: 14px 28px; font-size: 12px; line-height: 1.6;">
    <span style="color:#F5A623;">Side effects may include eating this on everything.</span><br>
    ${address}<br>
    You're receiving this because you joined the Flavor Doctors list.
    <a href="${unsubUrl}" style="color:#9aa7b5;">Unsubscribe</a>
  </div>
</div>`;

/**
 * Send a MARKETING email: consent-checked, CAN-SPAM footer with unsubscribe,
 * List-Unsubscribe headers, link/open tracking when a campaignId is given.
 * Template vars: {{SITE_URL}}, {{REF_CODE}}.
 */
export async function sendMarketingEmail(
  env: Env,
  origin: string,
  to: string,
  subject: string,
  innerHtml: string,
  opts: { campaignId?: string } = {}
): Promise<boolean> {
  const contact = await env.DB.prepare('SELECT * FROM contacts WHERE email = ?')
    .bind(to.toLowerCase())
    .first<ContactRow>();
  if (!contact || contact.marketing_consent !== 1) return false;

  const unsubUrl = `${origin}/unsubscribe?token=${contact.unsub_token}`;
  let inner = innerHtml
    .replaceAll('{{SITE_URL}}', origin)
    .replaceAll('{{REF_CODE}}', contact.ref_code ?? '');
  if (opts.campaignId) inner = instrumentHtml(inner, origin, opts.campaignId, to);

  const address = env.BUSINESS_ADDRESS ?? 'Flavor Doctors · New Prague, MN, USA';
  const html = MARKETING_WRAPPER(inner, unsubUrl, address);

  // Prefer the Email Service binding directly so we can set List-Unsubscribe.
  if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        from: parseFromVar(env),
        to,
        subject,
        html,
        text: inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        headers: {
          'List-Unsubscribe': `<${unsubUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'E_RECIPIENT_SUPPRESSED') return false;
      console.error('Marketing send via Email Service failed, falling back:', err);
    }
  }
  await sendEmail(env, to, subject, html);
  return true;
}

function parseFromVar(env: Env): { email: string; name?: string } {
  const raw = env.EMAIL_FROM ?? '';
  const match = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (match) return { name: match[1]?.trim() || undefined, email: match[2].trim() };
  return raw.includes('@') ? { email: raw.trim() } : { email: 'orders@flavordoctors.com', name: 'Flavor Doctors' };
}
