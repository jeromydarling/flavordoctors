import type { ProductRow, RequestContext } from '../types';
import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_FEE,
  BUNDLE_MIN_QTY,
  BUNDLE_COUPON,
  DROP_EARLY_ACCESS_MS,
  LIVE_SUB_STATUSES,
} from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { stripeRequest, ensureStripeCustomer, ensureCoupon } from '../lib/stripe';
import { getAuthUser } from '../lib/auth';

interface CartItem {
  productId: string;
  quantity: number;
}

export async function hasLiveSubscription(rc: RequestContext, userId: string): Promise<boolean> {
  const placeholders = LIVE_SUB_STATUSES.map(() => '?').join(',');
  const row = await rc.env.DB.prepare(
    `SELECT id FROM subscriptions WHERE user_id = ? AND status IN (${placeholders}) LIMIT 1`
  )
    .bind(userId, ...LIVE_SUB_STATUSES)
    .first();
  return !!row;
}

/** Validate limited-drop purchasability. Returns an error message or null. */
export function dropGateError(p: ProductRow, quantity: number, isSubscriber: boolean, now = Date.now()): string | null {
  if (p.is_drop !== 1) return null;
  const startsAt = p.drop_starts_at ? Date.parse(p.drop_starts_at) : 0;
  const openAt = isSubscriber ? startsAt - DROP_EARLY_ACCESS_MS : startsAt;
  if (now < openAt) {
    return `${p.name} is a Clinical Trial that hasn't opened yet${isSubscriber ? '' : ' — Rx Box subscribers get 48-hour early access'}`;
  }
  if (p.drop_stock !== null && p.drop_stock < quantity) {
    return p.drop_stock <= 0 ? `${p.name} is sold out` : `Only ${p.drop_stock} units of ${p.name} remain`;
  }
  return null;
}

/** One-time purchase: create a Stripe Checkout Session (guests allowed). */
export async function createCheckout(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<{ items?: CartItem[] }>(req);
  const items = (body?.items ?? []).filter(
    (i) => typeof i.productId === 'string' && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 20
  );
  if (items.length === 0 || items.length > 20) return errorResponse('Cart is empty or invalid');

  const ids = items.map((i) => i.productId);
  const placeholders = ids.map(() => '?').join(',');
  const { results: products } = await rc.env.DB.prepare(
    `SELECT * FROM products WHERE id IN (${placeholders}) AND is_active = 1`
  )
    .bind(...ids)
    .all<ProductRow>();
  const byId = new Map(products.map((p) => [p.id, p]));
  if (products.length !== ids.length) return errorResponse('One or more products are unavailable');

  const user = await getAuthUser(req, rc.env);
  const isSubscriber = user ? await hasLiveSubscription(rc, user.id) : false;

  // Limited drops: enforce open window (subscribers get early access) and stock.
  for (const i of items) {
    const gateError = dropGateError(byId.get(i.productId)!, i.quantity, isSubscriber);
    if (gateError) return errorResponse(gateError);
  }

  const origin = new URL(req.url).origin;
  const subtotal = items.reduce((n, i) => n + i.quantity * byId.get(i.productId)!.price, 0);
  const totalQty = items.reduce((n, i) => n + i.quantity, 0);
  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;

  // "Any 3+ items — 15% off" bundle discount, applied automatically.
  let discounts: { coupon: string }[] | undefined;
  if (totalQty >= BUNDLE_MIN_QTY) {
    try {
      discounts = [{ coupon: await ensureCoupon(rc.env, BUNDLE_COUPON.id, BUNDLE_COUPON.percentOff, BUNDLE_COUPON.name) }];
    } catch (err) {
      console.error('Bundle coupon unavailable, continuing without discount:', err);
    }
  }

  // Compact cart stored in metadata (< 500 chars) so the webhook can build the order.
  const cartMeta = JSON.stringify(items.map((i) => ({ p: i.productId, q: i.quantity })));

  const session = await stripeRequest<{ id: string; url: string }>(rc.env, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel`,
    ...(user
      ? { customer: await ensureStripeCustomer(rc.env, user.id, user.email) }
      : { customer_creation: 'always' }),
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: freeShipping ? 'Free shipping' : 'Standard shipping',
          fixed_amount: { amount: freeShipping ? 0 : SHIPPING_FEE, currency: 'usd' },
        },
      },
    ],
    ...(discounts ? { discounts } : {}),
    line_items: items.map((i) => {
      const p = byId.get(i.productId)!;
      return {
        quantity: i.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: p.price,
          product_data: {
            name: p.name,
            description: p.description.slice(0, 200),
          },
        },
      };
    }),
    metadata: {
      kind: 'order',
      cart: cartMeta,
      ...(user ? { user_id: user.id } : {}),
    },
  });

  return json({ url: session.url });
}
