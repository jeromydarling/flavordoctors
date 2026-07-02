import { LOYALTY_TIERS } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { requireAuth } from '../lib/auth';

/** Board Certification: points balance + current/next tier. */
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

  return json({
    points,
    tier: { key: tier.key, name: tier.name },
    nextTier: nextTier ? { key: nextTier.key, name: nextTier.name, pointsNeeded: nextTier.min - points } : null,
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
