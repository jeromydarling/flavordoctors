import type { ProductRow, RequestContext } from '../types';
import { DROP_EARLY_ACCESS_MS } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { getAuthUser } from '../lib/auth';
import { publicProduct } from './products';
import { hasLiveSubscription } from './checkout';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type DropState = 'upcoming' | 'early-access' | 'live' | 'sold-out';

function dropState(p: ProductRow, now: number): DropState {
  if (p.drop_stock !== null && p.drop_stock <= 0) return 'sold-out';
  const startsAt = p.drop_starts_at ? Date.parse(p.drop_starts_at) : 0;
  if (now >= startsAt) return 'live';
  if (now >= startsAt - DROP_EARLY_ACCESS_MS) return 'early-access';
  return 'upcoming';
}

/** Clinical Trials: current limited drops with state + early-access info. */
export async function listDrops(req: Request, rc: RequestContext): Promise<Response> {
  const { results } = await rc.env.DB.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND is_drop = 1 ORDER BY drop_starts_at'
  ).all<ProductRow>();

  const user = await getAuthUser(req, rc.env);
  const isSubscriber = user ? await hasLiveSubscription(rc, user.id) : false;
  const now = Date.now();

  const drops = results.map((p) => {
    const state = dropState(p, now);
    const startsAt = p.drop_starts_at ? Date.parse(p.drop_starts_at) : null;
    return {
      product: publicProduct(p),
      state,
      startsAt: p.drop_starts_at,
      earlyAccessAt: startsAt ? new Date(startsAt - DROP_EARLY_ACCESS_MS).toISOString() : null,
      stock: p.drop_stock,
      canBuy: state === 'live' || (state === 'early-access' && isSubscriber),
    };
  });

  return json({ drops, isSubscriber });
}

/** Enroll in a trial waitlist (guests can pass an email; users use their own). */
export async function joinWaitlist(req: Request, rc: RequestContext): Promise<Response> {
  const product = await rc.env.DB.prepare('SELECT * FROM products WHERE id = ? AND is_drop = 1 AND is_active = 1')
    .bind(rc.params.id)
    .first<ProductRow>();
  if (!product) return errorResponse('Trial not found', 404);

  const user = await getAuthUser(req, rc.env);
  const body = await readJson<{ email?: string }>(req);
  const email = (user?.email ?? body?.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return errorResponse('A valid email is required');

  await rc.env.DB.prepare('INSERT OR IGNORE INTO drop_waitlist (email, product_id) VALUES (?, ?)')
    .bind(email, product.id)
    .run();
  return json({ ok: true, enrolled: true });
}
