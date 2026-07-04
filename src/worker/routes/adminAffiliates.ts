import { json, errorResponse, readJson } from '../lib/util';
import { requireAdmin } from '../lib/auth';
import { audit } from '../lib/audit';
import {
  type AffiliateRow,
  AFF_TIERS,
  PAYOUT_FLOOR,
  PROBATION_PAYOUT_CAP,
  CREDIT_MULTIPLIER,
  approveAffiliate,
  balancesFor,
  deactivateStripeCode,
} from '../lib/affiliates';
import { stripeRequest } from '../lib/stripe';
import { sendEmail } from '../lib/email';

interface RosterRow extends AffiliateRow {
  clicks30d: number;
  conversions: number;
  attributed_revenue: number;
  refunded_orders: number;
}

/** Applications queue + roster with balances and behavioral flags. */
export const listAffiliates = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare(
    `SELECT a.*,
       (SELECT COUNT(*) FROM affiliate_clicks c WHERE c.affiliate_id = a.id AND c.created_at > datetime('now','-30 days')) AS clicks30d,
       (SELECT COUNT(*) FROM orders o WHERE o.affiliate_id = a.id AND o.status != 'canceled') AS conversions,
       (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.affiliate_id = a.id AND o.status != 'canceled') AS attributed_revenue,
       (SELECT COUNT(*) FROM orders o WHERE o.affiliate_id = a.id AND o.status = 'refunded') AS refunded_orders
     FROM affiliates a ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 300`
  ).all<RosterRow>();

  const roster = [];
  for (const a of results) {
    const balances = await balancesFor(rc.env, a.id);
    const flags: string[] = [];
    if (a.conversions >= 5 && a.clicks30d === 0) flags.push('conversions with zero clicks — possible code leak');
    if (a.conversions >= 3 && a.refunded_orders / a.conversions > 0.3) flags.push('refund rate above 30%');
    roster.push({
      id: a.id,
      name: a.name,
      email: a.email,
      handle: a.handle,
      links: a.links ? (JSON.parse(a.links) as string[]) : [],
      audience: a.audience,
      pitch: a.pitch,
      status: a.status,
      aiScore: a.ai_score,
      aiReasoning: a.ai_reasoning,
      code: a.code,
      codeSynced: a.code_synced === 1,
      tier: a.tier,
      tierName: AFF_TIERS[a.tier]?.name ?? a.tier,
      probation: a.probation === 1,
      payoutMethod: a.payout_method,
      clicks30d: a.clicks30d,
      conversions: a.conversions,
      attributedRevenue: a.attributed_revenue,
      balances,
      flags,
      createdAt: a.created_at,
    });
  }
  const stats = await rc.env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(total),0) FROM orders WHERE affiliate_id IS NOT NULL AND status != 'canceled') AS revenue,
       (SELECT COALESCE(SUM(amount),0) FROM affiliate_commissions WHERE kind IN ('first_order','recurring') AND status != 'void') AS commissions`
  ).first<{ revenue: number; commissions: number }>();
  return json({ affiliates: roster, program: stats });
});

/** Approve / reject / pause / ban / reactivate. Pausing or banning kills the Stripe code. */
export const decideAffiliate = requireAdmin(async (req, rc) => {
  const b = await readJson<{ action?: string }>(req);
  const action = b?.action;
  if (!action || !['approve', 'reject', 'pause', 'ban', 'reactivate'].includes(action)) {
    return errorResponse('action must be approve, reject, pause, ban, or reactivate');
  }
  const aff = await rc.env.DB.prepare('SELECT * FROM affiliates WHERE id = ?').bind(rc.params.id).first<AffiliateRow>();
  if (!aff) return errorResponse('Affiliate not found', 404);

  if (action === 'approve') {
    await approveAffiliate(rc.env, aff.id, rc.user!.email);
  } else if (action === 'reactivate') {
    await rc.env.DB.prepare("UPDATE affiliates SET status = 'approved' WHERE id = ?").bind(aff.id).run();
    if (aff.code) rc.ctx.waitUntil(rc.env.DB.prepare('UPDATE affiliates SET code_synced = 0 WHERE id = ?').bind(aff.id).run());
    rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'affiliate_reactivate', aff.email));
  } else {
    const status = action === 'reject' ? 'rejected' : action === 'pause' ? 'paused' : 'banned';
    await rc.env.DB.prepare('UPDATE affiliates SET status = ? WHERE id = ?').bind(status, aff.id).run();
    if (aff.code && (action === 'pause' || action === 'ban')) {
      rc.ctx.waitUntil(deactivateStripeCode(rc.env, aff.code));
    }
    rc.ctx.waitUntil(audit(rc.env, rc.user!.email, `affiliate_${action}`, aff.email));
  }
  return json({ ok: true });
});

/**
 * Release payouts — the one manual touch in the whole program (~30s/month).
 * Pays every approved affiliate whose cleared balance ≥ $25: store credit at
 * 1.25× or a Stripe Connect transfer. Flagged affiliates are skipped and
 * reported. Probation caps the first payout and lifts after it succeeds.
 */
export const releasePayouts = requireAdmin(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare("SELECT * FROM affiliates WHERE status = 'approved'").all<AffiliateRow>();
  const paid: { email: string; amount: number; method: string }[] = [];
  const skipped: { email: string; reason: string }[] = [];

  for (const aff of results) {
    const balances = await balancesFor(rc.env, aff.id);
    if (balances.cleared < PAYOUT_FLOOR) continue;

    // Behavioral flags block payout until a human clears them.
    const [clicks, conv, refunded] = await Promise.all([
      rc.env.DB.prepare("SELECT COUNT(*) AS n FROM affiliate_clicks WHERE affiliate_id = ? AND created_at > datetime('now','-30 days')").bind(aff.id).first<{ n: number }>(),
      rc.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE affiliate_id = ? AND status != 'canceled'").bind(aff.id).first<{ n: number }>(),
      rc.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE affiliate_id = ? AND status = 'refunded'").bind(aff.id).first<{ n: number }>(),
    ]);
    if ((conv?.n ?? 0) >= 5 && (clicks?.n ?? 0) === 0) {
      skipped.push({ email: aff.email, reason: 'flag: conversions with zero clicks' });
      continue;
    }
    if ((conv?.n ?? 0) >= 3 && (refunded?.n ?? 0) / (conv?.n ?? 1) > 0.3) {
      skipped.push({ email: aff.email, reason: 'flag: refund rate above 30%' });
      continue;
    }

    let amount = balances.cleared;
    if (aff.probation === 1) amount = Math.min(amount, PROBATION_PAYOUT_CAP);
    const payoutRef = `po_${aff.id}_${new Date().toISOString().slice(0, 7)}`; // one per affiliate per month

    if (aff.payout_method === 'connect') {
      if (!aff.stripe_account_id) {
        skipped.push({ email: aff.email, reason: 'no bank connected — asked to finish Stripe onboarding' });
        continue;
      }
      try {
        await stripeRequest(rc.env, 'POST', '/v1/transfers', {
          amount: String(amount),
          currency: 'usd',
          destination: aff.stripe_account_id,
          metadata: { affiliate_id: aff.id, payout_ref: payoutRef },
        });
      } catch (err) {
        skipped.push({ email: aff.email, reason: `Stripe transfer failed: ${(err as Error).message.slice(0, 80)}` });
        continue;
      }
    } else {
      // Store credit at 1.25× — straight into the points ledger.
      const points = Math.round((amount * CREDIT_MULTIPLIER) / 1); // 1 pt = 1¢
      await rc.env.DB.prepare(
        "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'bonus', ?)"
      )
        .bind(aff.user_id, points, `affiliate:${payoutRef}`)
        .run();
    }

    await rc.env.DB.prepare(
      "INSERT OR IGNORE INTO affiliate_commissions (affiliate_id, kind, amount, status, ref) VALUES (?, 'payout', ?, 'cleared', ?)"
    )
      .bind(aff.id, -amount, payoutRef)
      .run();
    if (aff.probation === 1) {
      await rc.env.DB.prepare('UPDATE affiliates SET probation = 0 WHERE id = ?').bind(aff.id).run();
    }
    paid.push({ email: aff.email, amount, method: aff.payout_method });
    rc.ctx.waitUntil(
      sendEmail(
        rc.env,
        aff.email,
        'Your House Call Network payout is on the way 💸',
        aff.payout_method === 'connect'
          ? `<p>We just sent <strong>$${(amount / 100).toFixed(2)}</strong> to your connected bank account. Statement in your portal — thank you for spreading the flavor, Doctor.</p>`
          : `<p><strong>${Math.round(amount * CREDIT_MULTIPLIER)} points</strong> (your $${(amount / 100).toFixed(2)} balance at 1.25×) just landed in your chart — redeemable at checkout. Thank you for spreading the flavor, Doctor.</p>`
      )
    );
  }

  rc.ctx.waitUntil(
    audit(rc.env, rc.user!.email, 'affiliate_payout_run', undefined, `${paid.length} paid, ${skipped.length} skipped`)
  );
  return json({ paid, skipped });
});
