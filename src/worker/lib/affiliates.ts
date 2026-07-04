import type { Env } from '../types';
import { newId } from './util';
import { runChat } from './ai';
import { ensureCoupon, stripeRequest } from './stripe';
import { sendEmail } from './email';
import { audit } from './audit';

// ---------- Program constants (all money math is deterministic code) ----------

export const AFFILIATE_DISCOUNT = { id: 'FD_AFF_15', percentOff: 15, name: 'House Call Network — 15% off' };
export const AFF_TIERS = {
  resident: { name: 'Resident', firstPct: 25, recurringPct: 10, minRevenue: 0 },
  attending: { name: 'Attending', firstPct: 28, recurringPct: 12, minRevenue: 100_000 }, // $1k attributed
  chief: { name: 'Chief of Medicine', firstPct: 30, recurringPct: 15, minRevenue: 500_000 }, // $5k
} as const;
export type AffiliateTier = keyof typeof AFF_TIERS;
export const RECURRING_MONTHS = 12; // renewals earn for the sub's first year
export const CLEAR_DAYS = 30; // refund window before a commission clears
export const PROBATION_CLEAR_DAYS = 45;
export const PROBATION_PAYOUT_CAP = 20_000; // first payout ≤ $200 while on probation
export const PAYOUT_FLOOR = 2_500; // $25 minimum payout
export const CREDIT_MULTIPLIER = 1.25; // store-credit payouts pay 1.25×
export const AUTO_APPROVE_SCORE = 75;
export const AUTO_REJECT_SCORE = 30;

export interface AffiliateRow {
  id: string;
  user_id: string;
  email: string;
  name: string;
  handle: string | null;
  links: string | null;
  audience: string | null;
  pitch: string | null;
  status: string;
  ai_score: number | null;
  ai_reasoning: string | null;
  ref_code: string | null;
  code: string | null;
  code_synced: number;
  tier: AffiliateTier;
  payout_method: string;
  stripe_account_id: string | null;
  probation: number;
  created_at: string;
  approved_at: string | null;
}

// ---------- Gate 1: deterministic pre-checks (no AI) ----------

const DISPOSABLE_DOMAINS = ['mailinator.com', 'guerrillamail.com', 'tempmail.com', '10minutemail.com', 'yopmail.com', 'sharklasers.com'];

export function gate1Error(app: { email: string; name?: string; links?: string[]; audience?: string; pitch?: string }): string | null {
  if (!app.name?.trim()) return 'name is required';
  const links = (app.links ?? []).filter((l) => typeof l === 'string' && l.trim());
  if (links.length === 0) return 'At least one link (social profile or site) is required';
  if (links.some((l) => !/^https?:\/\/\S+\.\S+/.test(l.trim()))) return 'Links must be full URLs (https://…)';
  if (!app.audience?.trim() || app.audience.trim().length < 20) return 'Tell us about your audience (a sentence or two)';
  if (!app.pitch?.trim() || app.pitch.trim().length < 20) return 'Tell us how you would prescribe Flavor Doctors to them';
  const domain = app.email.split('@')[1]?.toLowerCase() ?? '';
  if (DISPOSABLE_DOMAINS.includes(domain)) return 'Please apply with a permanent email address';
  return null;
}

// ---------- Gate 2: the rubric Llama scores against ----------

const RUBRIC = `You screen affiliate applications for "Flavor Doctors", a premium small-batch
sauce & seasoning brand with a playful medical/prescription THEME (satire — the
products make no real health claims, ever).

Score the application 0-100 overall from these dimensions:
1. AUDIENCE FIT — food, cooking, BBQ/grilling, meal prep, busy-family dinners,
   homesteading, foodie lifestyle, fitness meal-preppers. Adjacent niches with
   genuine food enthusiasm still score well. Micro audiences are welcome:
   a few hundred ENGAGED followers beats 50k passive ones.
2. AUTHENTICITY — reads like a real, findable person: consistent handle,
   describes content they actually make, gives a SPECIFIC answer for how they
   would promote us. Vague form-letter answers score low.
3. BRAND SAFETY — comfortable with playful medical satire WITHOUT making real
   health/medical claims. Any hint they would market the products as healing,
   curing, or treating real conditions is disqualifying.

Red flags (set the boolean, each one blocks auto-approval):
- coupon/deal aggregator site, cashback service, or "incentivized traffic"
- intends to buy through their own link, promises guaranteed sales, or plans
  paid search ads on the brand name
- health-claim language, adult/hate content, spam signals

Respond ONLY with JSON:
{"score": <0-100>, "redFlags": <boolean>, "redFlagReason": <string|null>,
 "summary": <one-sentence assessment for the human reviewer>}`;

export interface AiVerdict {
  score: number;
  redFlags: boolean;
  reasoning: string;
}

/** Score an application. Throws when AI is unavailable → caller fails CLOSED (queue for human). */
export async function scoreApplication(env: Env, app: AffiliateRow): Promise<AiVerdict> {
  const raw = await runChat(
    env,
    [
      { role: 'system', content: RUBRIC },
      {
        role: 'user',
        content: `Application:\nName: ${app.name}\nHandle: ${app.handle ?? '—'}\nLinks: ${app.links ?? '[]'}\nAudience: ${app.audience}\nHow they'd promote us: ${app.pitch}`,
      },
    ],
    400
  );
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
    score?: number;
    redFlags?: boolean;
    redFlagReason?: string | null;
    summary?: string;
  };
  if (typeof parsed.score !== 'number' || typeof parsed.redFlags !== 'boolean') {
    throw new Error('AI verdict missing required fields');
  }
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  const reasoning = [parsed.summary, parsed.redFlagReason ? `Red flag: ${parsed.redFlagReason}` : null]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
  return { score, redFlags: parsed.redFlags, reasoning };
}

// ---------- Vanity code provisioning ----------

function fallbackCode(name: string, handle: string | null): string {
  const base = (handle || name).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10) || 'DOC';
  return `DR${base}15`.slice(0, 18);
}

async function codeTaken(env: Env, code: string): Promise<boolean> {
  const [aff, promo] = await Promise.all([
    env.DB.prepare('SELECT 1 FROM affiliates WHERE code = ?').bind(code).first(),
    env.DB.prepare('SELECT 1 FROM promotions WHERE code = ?').bind(code).first(),
  ]);
  return !!aff || !!promo;
}

/** Pick a vanity code: Llama suggests, deterministic fallback, collision-checked. */
export async function pickVanityCode(env: Env, name: string, handle: string | null): Promise<string> {
  const candidates: string[] = [];
  try {
    const raw = await runChat(
      env,
      [
        {
          role: 'system',
          content:
            'Suggest 3 short, memorable, family-friendly affiliate discount codes for a medical-themed sauce brand, based on the person\'s name/handle. 4-16 chars, A-Z and 0-9 only, feel like "DRSARAH15" or "CHEFMIKE15". Respond ONLY with JSON: {"codes": ["...", "...", "..."]}',
        },
        { role: 'user', content: `Name: ${name}. Handle: ${handle ?? 'none'}.` },
      ],
      150
    );
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { codes?: string[] };
    for (const c of parsed.codes ?? []) {
      const clean = String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length >= 4 && clean.length <= 18) candidates.push(clean);
    }
  } catch {
    // AI offline — the deterministic fallback covers it.
  }
  candidates.push(fallbackCode(name, handle));
  for (const c of candidates) {
    if (!(await codeTaken(env, c))) return c;
  }
  // Everything collided — suffix the fallback with a random tail.
  return `${fallbackCode(name, handle).slice(0, 13)}${Math.floor(Math.random() * 9000 + 1000)}`;
}

/** Create the affiliate's promo code in Stripe (retried by cron until synced). */
export async function syncStripeCode(env: Env, affiliate: { id: string; code: string | null }): Promise<boolean> {
  if (!affiliate.code) return false;
  try {
    await ensureCoupon(env, AFFILIATE_DISCOUNT.id, AFFILIATE_DISCOUNT.percentOff, AFFILIATE_DISCOUNT.name);
    try {
      await stripeRequest(env, 'POST', '/v1/promotion_codes', {
        coupon: AFFILIATE_DISCOUNT.id,
        code: affiliate.code,
        metadata: { affiliate_id: affiliate.id },
      });
    } catch (err) {
      if (!/already exists/i.test((err as Error).message)) throw err;
    }
    await env.DB.prepare('UPDATE affiliates SET code_synced = 1 WHERE id = ?').bind(affiliate.id).run();
    return true;
  } catch (err) {
    console.error(`Stripe code sync failed for affiliate ${affiliate.id}:`, err);
    return false;
  }
}

/** Deactivate the promo code in Stripe (pause/ban). Best-effort. */
export async function deactivateStripeCode(env: Env, code: string): Promise<void> {
  try {
    const list = await stripeRequest<{ data: { id: string }[] }>(env, 'GET', `/v1/promotion_codes?code=${encodeURIComponent(code)}&limit=1`);
    if (list.data[0]) await stripeRequest(env, 'POST', `/v1/promotion_codes/${list.data[0].id}`, { active: 'false' });
  } catch (err) {
    console.error(`Stripe code deactivation failed for ${code}:`, err);
  }
}

// ---------- Approval (shared by auto and human paths) ----------

export async function approveAffiliate(env: Env, affiliateId: string, actor: string): Promise<AffiliateRow | null> {
  const aff = await env.DB.prepare('SELECT * FROM affiliates WHERE id = ?').bind(affiliateId).first<AffiliateRow>();
  if (!aff || aff.status === 'approved') return aff;

  const refCode = `hc_${newId('x').slice(2)}`;
  const code = aff.code ?? (await pickVanityCode(env, aff.name, aff.handle));
  await env.DB.prepare(
    "UPDATE affiliates SET status = 'approved', ref_code = COALESCE(ref_code, ?), code = ?, approved_at = datetime('now') WHERE id = ?"
  )
    .bind(refCode, code, aff.id)
    .run();
  const updated = await env.DB.prepare('SELECT * FROM affiliates WHERE id = ?').bind(aff.id).first<AffiliateRow>();
  await syncStripeCode(env, { id: aff.id, code });
  await audit(env, actor, 'affiliate_approve', aff.email, `code ${code}`);

  // Welcome kit — link, code, the rules, and a nudge to the library.
  const site = env.CANONICAL_HOST ? `https://${env.CANONICAL_HOST}` : 'https://flavordoctors.com';
  await sendEmail(
    env,
    aff.email,
    "You're in — welcome to the House Call Network 🩺",
    `<h2>Congratulations, Doctor — you're credentialed.</h2>
     <p>Your prescription pad:</p>
     <ul>
       <li><strong>Your link:</strong> <a href="${site}/?aff=${updated?.ref_code}">${site}/?aff=${updated?.ref_code}</a></li>
       <li><strong>Your code:</strong> <span style="font-size:20px;letter-spacing:2px;font-weight:bold">${code}</span> — gives your audience ${AFFILIATE_DISCOUNT.percentOff}% off, and every sale is credited to you</li>
       <li><strong>Your rates:</strong> ${AFF_TIERS.resident.firstPct}% on first orders, ${AFF_TIERS.resident.recurringPct}% on subscription renewals for a year</li>
     </ul>
     <p>Everything you need — product one-sheets, talking points, ready-to-post copy with your code baked in — lives in your
     <a href="${site}/affiliates/portal" style="color:#27AE60;font-weight:bold">Affiliate Portal →</a></p>
     <p style="color:#555;font-size:13px">House rules: always disclose the relationship (#ad or #FlavorDoctorsPartner), never make real health claims
     (the doctor thing is a bit, not a diagnosis), and never run search ads on our brand name. Full playbook in the portal.</p>`
  );
  return updated;
}

// ---------- Commission math (deterministic) ----------

export function tierFor(attributedRevenueCents: number): AffiliateTier {
  if (attributedRevenueCents >= AFF_TIERS.chief.minRevenue) return 'chief';
  if (attributedRevenueCents >= AFF_TIERS.attending.minRevenue) return 'attending';
  return 'resident';
}

/**
 * Record a commission. Idempotent per (kind, ref). Recomputes the affiliate's
 * tier from lifetime attributed revenue before applying the rate.
 */
export async function recordCommission(
  env: Env,
  affiliate: AffiliateRow,
  kind: 'first_order' | 'recurring',
  baseCents: number,
  ref: string,
  orderId: string | null
): Promise<void> {
  if (baseCents <= 0) return;
  const revenue = await env.DB.prepare(
    "SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE affiliate_id = ? AND status != 'canceled'"
  )
    .bind(affiliate.id)
    .first<{ n: number }>();
  const tier = tierFor(revenue?.n ?? 0);
  if (tier !== affiliate.tier) {
    await env.DB.prepare('UPDATE affiliates SET tier = ? WHERE id = ?').bind(tier, affiliate.id).run();
  }
  const pct = kind === 'first_order' ? AFF_TIERS[tier].firstPct : AFF_TIERS[tier].recurringPct;
  const amount = Math.round((baseCents * pct) / 100);
  const clearDays = affiliate.probation === 1 ? PROBATION_CLEAR_DAYS : CLEAR_DAYS;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO affiliate_commissions (affiliate_id, order_id, kind, amount, status, clears_at, ref)
     VALUES (?, ?, ?, ?, 'pending', datetime('now', '+' || ? || ' days'), ?)`
  )
    .bind(affiliate.id, orderId, kind, amount, clearDays, ref)
    .run();
}

/** Refund clawback: void pending commissions for the payment; offset cleared ones. */
export async function clawbackCommission(env: Env, paymentRef: string): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM affiliate_commissions WHERE ref = ? AND kind IN ('first_order', 'recurring')"
  )
    .bind(paymentRef)
    .all<{ id: number; affiliate_id: string; order_id: string | null; amount: number; status: string }>();
  for (const c of results) {
    if (c.status === 'pending') {
      await env.DB.prepare("UPDATE affiliate_commissions SET status = 'void' WHERE id = ?").bind(c.id).run();
    } else if (c.status === 'cleared') {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO affiliate_commissions (affiliate_id, order_id, kind, amount, status, ref)
         VALUES (?, ?, 'clawback', ?, 'cleared', ?)`
      )
        .bind(c.affiliate_id, c.order_id, -c.amount, `cb_${paymentRef}`)
        .run();
    }
  }
}

/**
 * Ledger accounting: earnings are positive rows (pending → cleared); payouts
 * and clawbacks are negative `cleared` rows. The cleared SUM therefore IS the
 * payable balance, and lifetime paid = -SUM(kind='payout').
 */
export interface AffiliateBalances {
  pending: number;
  cleared: number;
  paidOut: number;
}

export async function balancesFor(env: Env, affiliateId: string): Promise<AffiliateBalances> {
  const [byStatus, payouts] = await Promise.all([
    env.DB.prepare('SELECT status, SUM(amount) AS total FROM affiliate_commissions WHERE affiliate_id = ? GROUP BY status')
      .bind(affiliateId)
      .all<{ status: string; total: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM affiliate_commissions WHERE affiliate_id = ? AND kind = 'payout'")
      .bind(affiliateId)
      .first<{ total: number }>(),
  ]);
  const by = Object.fromEntries(byStatus.results.map((r) => [r.status, r.total]));
  return { pending: by.pending ?? 0, cleared: by.cleared ?? 0, paidOut: -(payouts?.total ?? 0) };
}
