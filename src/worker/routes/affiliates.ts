import type { RequestContext } from '../types';
import { json, errorResponse, readJson, newId } from '../lib/util';
import { requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import {
  type AffiliateRow,
  AFF_TIERS,
  AFFILIATE_DISCOUNT,
  AUTO_APPROVE_SCORE,
  AUTO_REJECT_SCORE,
  PAYOUT_FLOOR,
  CREDIT_MULTIPLIER,
  gate1Error,
  scoreApplication,
  approveAffiliate,
  balancesFor,
  tierFor,
} from '../lib/affiliates';
import { PLAYBOOKS, type ProductEnrichment, type PromoEnrichment } from '../lib/library';
import { stripeRequest } from '../lib/stripe';
import { sendEmail } from '../lib/email';

/**
 * Apply to the House Call Network. Gate 1 is deterministic; Gate 2 is the
 * Llama rubric. AI unavailable → the application queues for a human
 * (approvals fail CLOSED — nobody gets a money relationship from an outage).
 */
export const applyAffiliate = requireAuth(async (req, rc) => {
  const b = await readJson<{ name?: string; handle?: string; links?: string[]; audience?: string; pitch?: string }>(req);
  const existing = await rc.env.DB.prepare('SELECT id, status FROM affiliates WHERE user_id = ?')
    .bind(rc.user!.id)
    .first<{ id: string; status: string }>();
  if (existing && existing.status !== 'rejected') {
    return errorResponse('You already have an application on file — check your portal', 409);
  }

  const err = gate1Error({ email: rc.user!.email, ...b });
  if (err) return errorResponse(err);

  const id = existing?.id ?? newId('aff');
  const links = JSON.stringify((b!.links ?? []).map((l) => l.trim()).slice(0, 5));
  if (existing) {
    // Re-application after rejection: refresh the content, back to pending.
    await rc.env.DB.prepare(
      "UPDATE affiliates SET name = ?, handle = ?, links = ?, audience = ?, pitch = ?, status = 'pending', ai_score = NULL, ai_reasoning = NULL WHERE id = ?"
    )
      .bind(b!.name!.trim().slice(0, 80), b!.handle?.trim().slice(0, 60) || null, links, b!.audience!.trim().slice(0, 1000), b!.pitch!.trim().slice(0, 1000), id)
      .run();
  } else {
    await rc.env.DB.prepare(
      'INSERT INTO affiliates (id, user_id, email, name, handle, links, audience, pitch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, rc.user!.id, rc.user!.email, b!.name!.trim().slice(0, 80), b!.handle?.trim().slice(0, 60) || null, links, b!.audience!.trim().slice(0, 1000), b!.pitch!.trim().slice(0, 1000))
      .run();
  }

  // Gate 2 — Llama scores the rubric; deterministic thresholds decide.
  let status = 'pending';
  try {
    const app = await rc.env.DB.prepare('SELECT * FROM affiliates WHERE id = ?').bind(id).first<AffiliateRow>();
    const verdict = await scoreApplication(rc.env, app!);
    await rc.env.DB.prepare('UPDATE affiliates SET ai_score = ?, ai_reasoning = ? WHERE id = ?')
      .bind(verdict.score, verdict.reasoning, id)
      .run();
    if (!verdict.redFlags && verdict.score >= AUTO_APPROVE_SCORE) {
      await approveAffiliate(rc.env, id, 'ai-auto-approval');
      status = 'approved';
    } else if (verdict.redFlags && verdict.score <= AUTO_REJECT_SCORE) {
      await rc.env.DB.prepare("UPDATE affiliates SET status = 'rejected' WHERE id = ?").bind(id).run();
      status = 'rejected';
      rc.ctx.waitUntil(audit(rc.env, 'ai-auto-approval', 'affiliate_reject', rc.user!.email, verdict.reasoning));
      rc.ctx.waitUntil(
        sendEmail(
          rc.env,
          rc.user!.email,
          'About your House Call Network application',
          `<p>Thanks for applying to the Flavor Doctors affiliate program. After review, we're not able to approve this application right now. You're welcome to reapply as your channel grows — and you can always earn through the Refer-a-Patient program in your account.</p>`
        )
      );
    } else {
      rc.ctx.waitUntil(audit(rc.env, 'ai-screening', 'affiliate_queue', rc.user!.email, `score ${verdict.score}: ${verdict.reasoning}`));
    }
  } catch (err) {
    console.error('Affiliate AI screening unavailable — application queued for human review:', err);
  }

  return json({ ok: true, status }, 201);
});

/** Portal snapshot: status, link/code, stats, tier progress, balances. */
export const getMyAffiliate = requireAuth(async (req, rc) => {
  const aff = await rc.env.DB.prepare('SELECT * FROM affiliates WHERE user_id = ?')
    .bind(rc.user!.id)
    .first<AffiliateRow>();
  if (!aff) return json({ affiliate: null });
  if (aff.status !== 'approved') {
    return json({ affiliate: { status: aff.status } });
  }

  const [balances, clicks, conversions, revenue] = await Promise.all([
    balancesFor(rc.env, aff.id),
    rc.env.DB.prepare("SELECT COUNT(*) AS n FROM affiliate_clicks WHERE affiliate_id = ? AND created_at > datetime('now', '-30 days')")
      .bind(aff.id)
      .first<{ n: number }>(),
    rc.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE affiliate_id = ? AND status != 'canceled'").bind(aff.id).first<{ n: number }>(),
    rc.env.DB.prepare("SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE affiliate_id = ? AND status != 'canceled'")
      .bind(aff.id)
      .first<{ n: number }>(),
  ]);
  const host = rc.env.CANONICAL_HOST ? `https://${rc.env.CANONICAL_HOST}` : new URL(req.url).origin;
  const tier = tierFor(revenue?.n ?? 0);
  const nextTier = tier === 'resident' ? 'attending' : tier === 'attending' ? 'chief' : null;

  return json({
    affiliate: {
      status: aff.status,
      name: aff.name,
      link: `${host}/?aff=${aff.ref_code}`,
      code: aff.code,
      discountPct: AFFILIATE_DISCOUNT.percentOff,
      tier,
      tierName: AFF_TIERS[tier].name,
      rates: { firstPct: AFF_TIERS[tier].firstPct, recurringPct: AFF_TIERS[tier].recurringPct },
      nextTier: nextTier
        ? { name: AFF_TIERS[nextTier].name, revenueNeeded: Math.max(0, AFF_TIERS[nextTier].minRevenue - (revenue?.n ?? 0)) }
        : null,
      probation: aff.probation === 1,
      payoutMethod: aff.payout_method,
      connected: !!aff.stripe_account_id,
      payoutFloor: PAYOUT_FLOOR,
      creditMultiplier: CREDIT_MULTIPLIER,
      stats: {
        clicks30d: clicks?.n ?? 0,
        conversions: conversions?.n ?? 0,
        attributedRevenue: revenue?.n ?? 0,
        ...balances,
      },
    },
  });
});

export const setPayoutMethod = requireAuth(async (req, rc) => {
  const b = await readJson<{ method?: string }>(req);
  if (!b?.method || !['credit', 'connect'].includes(b.method)) return errorResponse('method must be credit or connect');
  const result = await rc.env.DB.prepare("UPDATE affiliates SET payout_method = ? WHERE user_id = ? AND status = 'approved'")
    .bind(b.method, rc.user!.id)
    .run();
  if (result.meta.changes === 0) return errorResponse('No approved affiliate account found', 404);
  return json({ ok: true });
});

/** Stripe Connect Express onboarding for cash payouts. */
export const connectOnboard = requireAuth(async (req, rc) => {
  const aff = await rc.env.DB.prepare("SELECT * FROM affiliates WHERE user_id = ? AND status = 'approved'")
    .bind(rc.user!.id)
    .first<AffiliateRow>();
  if (!aff) return errorResponse('No approved affiliate account found', 404);

  let accountId = aff.stripe_account_id;
  if (!accountId) {
    const account = await stripeRequest<{ id: string }>(rc.env, 'POST', '/v1/accounts', {
      type: 'express',
      email: aff.email,
      capabilities: { transfers: { requested: 'true' } },
      metadata: { affiliate_id: aff.id },
    });
    accountId = account.id;
    await rc.env.DB.prepare('UPDATE affiliates SET stripe_account_id = ? WHERE id = ?').bind(accountId, aff.id).run();
  }
  const origin = rc.env.CANONICAL_HOST ? `https://${rc.env.CANONICAL_HOST}` : new URL(req.url).origin;
  const link = await stripeRequest<{ url: string }>(rc.env, 'POST', '/v1/account_links', {
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${origin}/affiliates/portal`,
    return_url: `${origin}/affiliates/portal?connected=1`,
  });
  return json({ url: link.url });
});

/** Click tracking for ?aff= links (fired once per capture by the SPA). */
export async function trackAffiliateClick(req: Request, rc: RequestContext): Promise<Response> {
  const b = await readJson<{ ref?: string }>(req);
  if (!b?.ref || !/^hc_[a-z0-9]{1,40}$/.test(b.ref)) return json({ ok: true }); // never error a beacon
  const aff = await rc.env.DB.prepare("SELECT id FROM affiliates WHERE ref_code = ? AND status = 'approved'")
    .bind(b.ref)
    .first<{ id: string }>();
  if (aff) {
    rc.ctx.waitUntil(rc.env.DB.prepare('INSERT INTO affiliate_clicks (affiliate_id) VALUES (?)').bind(aff.id).run());
  }
  return json({ ok: true });
}

/**
 * The library. Product facts come straight from the live catalog; enrichments
 * from the nightly-refreshed cache. Copy carries {{CODE}}/{{LINK}} placeholders
 * that the portal substitutes with this affiliate's own.
 */
export const getLibrary = requireAuth(async (_req, rc) => {
  const aff = await rc.env.DB.prepare("SELECT * FROM affiliates WHERE user_id = ? AND status = 'approved'")
    .bind(rc.user!.id)
    .first<AffiliateRow>();
  if (!aff) return errorResponse('Affiliate access required', 403);

  const [products, promos, entries, reviews, recipes] = await Promise.all([
    rc.env.DB.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY is_bestseller DESC, collection, name').all(),
    rc.env.DB.prepare("SELECT id, name, code, percent_off, ends_at FROM promotions WHERE is_active = 1 AND ends_at > datetime('now')").all(),
    rc.env.DB.prepare('SELECT * FROM library_entries').all<{ kind: string; ref: string; title: string; content_json: string; updated_at: string }>(),
    rc.env.DB.prepare(
      `SELECT r.product_id, r.rating, r.body FROM product_reviews r WHERE r.approved = 1 AND r.rating >= 4
       ORDER BY r.created_at DESC LIMIT 60`
    ).all<{ product_id: string; rating: number; body: string }>(),
    rc.env.DB.prepare('SELECT slug, title, product_id FROM recipes WHERE is_published = 1').all<{ slug: string; title: string; product_id: string }>(),
  ]);

  const enrichmentByRef = new Map(entries.results.filter((e) => e.kind === 'product_kit').map((e) => [e.ref, e]));
  const promoCopyByRef = new Map(entries.results.filter((e) => e.kind === 'promo_kit').map((e) => [e.ref, e]));
  const reviewsByProduct = new Map<string, { rating: number; body: string }[]>();
  for (const r of reviews.results) {
    const list = reviewsByProduct.get(r.product_id) ?? [];
    if (list.length < 2) list.push({ rating: r.rating, body: r.body.slice(0, 200) });
    reviewsByProduct.set(r.product_id, list);
  }
  const recipesByProduct = new Map<string, { slug: string; title: string }[]>();
  for (const r of recipes.results) {
    const list = recipesByProduct.get(r.product_id) ?? [];
    list.push({ slug: r.slug, title: r.title });
    recipesByProduct.set(r.product_id, list);
  }

  const productKits = (products.results as Record<string, unknown>[]).map((p) => {
    const entry = enrichmentByRef.get(p.id as string);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      collection: p.collection,
      price: p.price,
      description: p.description,
      doctorsNotes: p.ai_description ?? null,
      imageUrl: p.image_r2_key ? `/images/${p.image_r2_key}` : null,
      isBestseller: p.is_bestseller === 1,
      quotes: reviewsByProduct.get(p.id as string) ?? [],
      treatmentPlans: recipesByProduct.get(p.id as string) ?? [],
      enrichment: entry ? (JSON.parse(entry.content_json) as ProductEnrichment) : null,
      updatedAt: entry?.updated_at ?? null,
    };
  });

  const promoKits = promos.results.map((promo) => {
    const entry = promoCopyByRef.get(promo.id as string);
    return {
      name: promo.name,
      sitewideCode: promo.code,
      percentOff: promo.percent_off,
      endsAt: promo.ends_at,
      copy: entry ? (JSON.parse(entry.content_json) as PromoEnrichment) : null,
    };
  });

  const cutoff = Date.now() - 30 * 86400000;
  const whatsNew = entries.results
    .filter((e) => Date.parse(e.updated_at + 'Z') > cutoff)
    .map((e) => ({ kind: e.kind, title: e.title, updatedAt: e.updated_at }))
    .slice(0, 12);

  // Playbooks with the affiliate's live rates substituted in.
  const playbooks = PLAYBOOKS.map((pb) => ({
    slug: pb.slug,
    title: pb.title,
    body: pb.body.map((line) =>
      line
        .replace(/\{\{FIRST_PCT\}\}/g, String(AFF_TIERS[aff.tier].firstPct))
        .replace(/\{\{RECURRING_PCT\}\}/g, String(AFF_TIERS[aff.tier].recurringPct))
    ),
  }));

  return json({ playbooks, productKits, promoKits, whatsNew });
});
