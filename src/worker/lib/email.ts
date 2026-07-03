import type { Env, EmailAddress } from '../types';

/** Parse an RFC-style "Name <addr@domain>" string into a structured address. */
function parseFrom(raw: string | undefined): EmailAddress {
  const fallback = { email: 'orders@flavordoctors.com', name: 'Flavor Doctors' };
  if (!raw) return fallback;
  const match = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (match) return { name: match[1]?.trim() || undefined, email: match[2].trim() };
  return raw.includes('@') ? { email: raw.trim() } : fallback;
}

/**
 * Send a transactional email.
 *
 * Provider chain:
 *  1. Cloudflare Email Service (`EMAIL` send_email binding) — native, 3,000/mo
 *     included on Workers Paid. Requires a sending domain onboarded under
 *     Email Service → Email Sending, and EMAIL_FROM on that domain.
 *  2. Resend (RESEND_API_KEY secret) — fallback if the binding is absent or errors.
 *  3. No-op with a log line — email problems never break checkout flows.
 */
export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  const from = parseFrom(env.EMAIL_FROM);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (env.EMAIL) {
    try {
      const result = await env.EMAIL.send({ from, to, subject, html, text });
      console.log(`Email sent via Email Service to=${to} id=${result.messageId ?? 'n/a'}`);
      return;
    } catch (err) {
      // Respect the platform suppression list (hard bounces/complaints):
      // do NOT re-send suppressed recipients through the fallback provider.
      if ((err as { code?: string }).code === 'E_RECIPIENT_SUPPRESSED') {
        console.log(`Email suppressed by Email Service (bounce/complaint history): to=${to}`);
        return;
      }
      console.error('Email Service send failed, trying fallback:', err);
    }
  }

  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM ?? 'Flavor Doctors <onboarding@resend.dev>',
          to: [to],
          subject,
          html,
        }),
      });
      if (!res.ok) console.error(`Resend send failed (${res.status}): ${await res.text()}`);
    } catch (err) {
      console.error('Resend send failed:', err);
    }
    return;
  }

  console.log(`[email skipped — no EMAIL binding or RESEND_API_KEY] to=${to} subject="${subject}"`);
}

const wrapper = (body: string) => `
<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; border: 2px solid #0D1B2A; border-radius: 8px; overflow: hidden;">
  <div style="background: #0D1B2A; color: #F5F5F5; padding: 20px 28px;">
    <span style="font-size: 26px; font-weight: bold;">℞ Flavor Doctors</span>
  </div>
  <div style="padding: 28px; background: #F5F5F5; color: #0D1B2A; font-size: 16px; line-height: 1.6;">
    ${body}
  </div>
  <div style="background: #0D1B2A; color: #F5A623; padding: 14px 28px; font-size: 13px;">
    Side effects may include eating this on everything.
  </div>
</div>`;

export function orderConfirmationEmail(items: { name: string; quantity: number }[], totalCents: number): string {
  const rows = items
    .map((i) => `<li>${i.quantity} × ${escapeHtml(i.name)}</li>`)
    .join('');
  return wrapper(`
    <h2 style="margin-top:0;">Your prescription has been filled 💊</h2>
    <p>Thanks for your order! Here's what the doctor sent:</p>
    <ul>${rows}</ul>
    <p><strong>Total: $${(totalCents / 100).toFixed(2)}</strong></p>
    <p>We'll notify you when your order ships.</p>`);
}

export function subscriptionConfirmationEmail(tierName: string, itemsPerMonth: number): string {
  return wrapper(`
    <h2 style="margin-top:0;">Welcome to the ${escapeHtml(tierName)} Monthly Rx Box 🩺</h2>
    <p>Your subscription is active — ${itemsPerMonth} doctored delights each month.</p>
    <p>Visit your account to customize your box; otherwise, we'll prescribe our best-sellers.</p>`);
}

export function refillReminderEmail(siteUrl: string): string {
  return wrapper(`
    <h2 style="margin-top:0;">Your prescription is running low 💊</h2>
    <p>By our chart, it's been about a month since your last Flavor Doctors order — dangerously close to
    a flavor relapse.</p>
    <p><a href="${siteUrl}/menu" style="color:#27AE60;font-weight:bold;">Refill your prescription →</a></p>
    <p style="font-size:13px;color:#555;">Pro tip: 3+ items save 15% automatically, and orders over $45 ship free.</p>`);
}

export function winBackEmail(siteUrl: string): string {
  return wrapper(`
    <h2 style="margin-top:0;">The doctor misses you 🩺</h2>
    <p>Your Monthly Rx Box lapsed, and frankly, we're worried about your flavor levels.</p>
    <p>New treatments have hit the pharmacy since you left — come see what's new, or restart your box
    in under a minute.</p>
    <p><a href="${siteUrl}/subscribe" style="color:#27AE60;font-weight:bold;">Renew my prescription →</a></p>`);
}

export function dropOpenEmail(productName: string, slug: string, siteUrl: string): string {
  return wrapper(`
    <h2 style="margin-top:0;">Clinical Trial now enrolling 🧪</h2>
    <p><strong>${escapeHtml(productName)}</strong> is now available — you're on the trial waitlist, so
    you're hearing it first. Batches are limited and don't get restocked.</p>
    <p><a href="${siteUrl}/product/${slug}" style="color:#27AE60;font-weight:bold;">Claim your dose →</a></p>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
