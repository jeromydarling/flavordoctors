import { LOYALTY_TIERS, POINT_VALUE_CENTS, REDEEM_BLOCK } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { requireAuth } from '../lib/auth';
import { upsertContact } from '../lib/marketing';

/** Board Certification: points balance + current/next tier + redemption math. */
export const getMyLoyalty = requireAuth(async (_req, rc) => {
  const row = await rc.env.DB.prepare('SELECT COALESCE(SUM(delta), 0) AS points FROM points_ledger WHERE user_id = ?')
    .bind(rc.user!.id)
    .first<{ points: number }>();
  const points = row?.points ?? 0;

  let tier: (typeof LOYALTY_TIERS)[number] = LOYALTY_TIERS[0];
  for (const t of LOYALTY_TIERS) {
    if (points >= t.min) tier = t;
  }
  const nextTier = LOYALTY_TIERS.find((t) => t.min > points) ?? null;

  const redeemable = Math.floor(points / REDEEM_BLOCK) * REDEEM_BLOCK;
  return json({
    points,
    tier: { key: tier.key, name: tier.name },
    nextTier: nextTier ? { key: nextTier.key, name: nextTier.name, pointsNeeded: nextTier.min - points } : null,
    redemption: {
      block: REDEEM_BLOCK,
      blockValueCents: REDEEM_BLOCK * POINT_VALUE_CENTS,
      redeemablePoints: redeemable,
      redeemableValueCents: redeemable * POINT_VALUE_CENTS,
    },
  });
});

/** Refer a Patient: the user's share link + how their referrals are doing. */
export const getMyReferral = requireAuth(async (req, rc) => {
  // Everyone with an account gets a contact row (and therefore a ref code).
  await upsertContact(rc.env, rc.user!.email, { userId: rc.user!.id, source: 'account' });
  const contact = await rc.env.DB.prepare('SELECT ref_code FROM contacts WHERE email = ?')
    .bind(rc.user!.email)
    .first<{ ref_code: string }>();
  if (!contact) return errorResponse('Could not load your referral code', 500);

  const [signups, converted, earned] = await Promise.all([
    rc.env.DB.prepare('SELECT COUNT(*) AS n FROM contacts WHERE referred_by = ?').bind(contact.ref_code).first<{ n: number }>(),
    rc.env.DB.prepare(
      `SELECT COUNT(DISTINCT c.email) AS n FROM contacts c
       WHERE c.referred_by = ? AND EXISTS (SELECT 1 FROM orders o WHERE o.email = c.email AND o.status != 'canceled')`
    ).bind(contact.ref_code).first<{ n: number }>(),
    rc.env.DB.prepare(
      "SELECT COALESCE(SUM(delta), 0) AS pts FROM points_ledger WHERE user_id = ? AND reason = 'referral'"
    ).bind(rc.user!.id).first<{ pts: number }>(),
  ]);

  const host = rc.env.CANONICAL_HOST ? `https://${rc.env.CANONICAL_HOST}` : new URL(req.url).origin;
  return json({
    code: contact.ref_code,
    url: `${host}/?ref=${contact.ref_code}`,
    signups: signups?.n ?? 0,
    converted: converted?.n ?? 0,
    pointsEarned: earned?.pts ?? 0,
  });
});

/** Flavor Health Record: 1-click "how did the treatment work?" rating. */
export const rateProduct = requireAuth(async (req, rc) => {
  const body = await readJson<{ rating?: number }>(req);
  const rating = body?.rating;
  if (!Number.isInteger(rating) || rating! < 1 || rating! > 5) return errorResponse('rating must be 1-5');

  const product = await rc.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(rc.params.id).first();
  if (!product) return errorResponse('Product not found', 404);

  await rc.env.DB.prepare(
    `INSERT INTO product_ratings (user_id, product_id, rating) VALUES (?, ?, ?)
     ON CONFLICT (user_id, product_id) DO UPDATE SET rating = excluded.rating, created_at = datetime('now')`
  )
    .bind(rc.user!.id, rc.params.id, rating)
    .run();
  return json({ ok: true, rating });
});

/** All of the user's ratings (product_id -> rating). */
export const getMyRatings = requireAuth(async (_req, rc) => {
  const { results } = await rc.env.DB.prepare('SELECT product_id, rating FROM product_ratings WHERE user_id = ?')
    .bind(rc.user!.id)
    .all<{ product_id: string; rating: number }>();
  const ratings: Record<string, number> = {};
  for (const r of results) ratings[r.product_id] = r.rating;
  return json({ ratings });
});
