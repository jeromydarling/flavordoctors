import type { ProductRow, RequestContext } from '../types';
import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_FEE,
  BUNDLE_MIN_QTY,
  BUNDLE_COUPON,
  DROP_EARLY_ACCESS_MS,
  LIVE_SUB_STATUSES,
  POINT_VALUE_CENTS,
  REDEEM_BLOCK,
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
  const body = await readJson<{ items?: CartItem[]; redeemPoints?: number; affiliateRef?: string }>(req);
  const affiliateRef = /^hc_[a-z0-9]{1,40}$/.test(body?.affiliateRef ?? '') ? body!.affiliateRef! : null;
  const items = (body?.items ?? []).filter(
    (i) => typeof i.productId === 'string' && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 20
  );
  if (items.length === 0 || items.length > 20) return errorResponse('Cart is empty or invalid');
  const redeemPoints = body?.redeemPoints ?? 0;

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

  // Board Certification points: validated here, deducted by the webhook once
  // the payment actually lands (abandoned carts never touch the balance).
  let pointsValue = 0;
  if (redeemPoints) {
    if (!user) return errorResponse('Sign in to redeem points');
    if (!Number.isInteger(redeemPoints) || redeemPoints < REDEEM_BLOCK || redeemPoints % REDEEM_BLOCK !== 0) {
      return errorResponse(`Points are redeemed in blocks of ${REDEEM_BLOCK}`);
    }
    const balance = await rc.env.DB.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS points FROM points_ledger WHERE user_id = ?'
    )
      .bind(user.id)
      .first<{ points: number }>();
    if ((balance?.points ?? 0) < redeemPoints) return errorResponse('Not enough points for that redemption');
    pointsValue = Math.min(redeemPoints * POINT_VALUE_CENTS, subtotal - 50); // leave ≥ $0.50 for Stripe's minimum
    if (pointsValue <= 0) return errorResponse('Cart is too small to redeem points on');
  }

  // "Any 3+ items — 15% off" bundle discount, applied automatically. When
  // points are in play, Stripe allows only one discount — fold both into a
  // single one-off amount coupon.
  let discounts: { coupon: string }[] | undefined;
  const bundleApplies = totalQty >= BUNDLE_MIN_QTY;
  try {
    if (pointsValue > 0) {
      const bundleAmount = bundleApplies ? Math.round((subtotal * BUNDLE_COUPON.percentOff) / 100) : 0;
      const oneOff = await stripeRequest<{ id: string }>(rc.env, 'POST', '/v1/coupons', {
        amount_off: pointsValue + bundleAmount,
        currency: 'usd',
        duration: 'once',
        name: bundleApplies
          ? `${redeemPoints} pts + bundle 15% off`
          : `${redeemPoints} Board Certification points`,
      });
      discounts = [{ coupon: oneOff.id }];
    } else if (bundleApplies) {
      discounts = [{ coupon: await ensureCoupon(rc.env, BUNDLE_COUPON.id, BUNDLE_COUPON.percentOff, BUNDLE_COUPON.name) }];
    }
  } catch (err) {
    if (pointsValue > 0) throw err; // never silently sell without the promised discount
    console.error('Bundle coupon unavailable, continuing without discount:', err);
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
    // Enable after activating Stripe Tax in the dashboard (set STRIPE_TAX_ENABLED="1").
    ...(rc.env.STRIPE_TAX_ENABLED === '1' ? { automatic_tax: { enabled: true } } : {}),
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: freeShipping ? 'Free shipping' : 'Standard shipping',
          fixed_amount: { amount: freeShipping ? 0 : SHIPPING_FEE, currency: 'usd' },
        },
      },
    ],
    // Stripe forbids combining fixed discounts with customer promo codes:
    // bundles get the automatic 15%; otherwise shoppers can enter promo codes.
    ...(discounts ? { discounts } : { allow_promotion_codes: true }),
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
      ...(pointsValue > 0 ? { redeem_points: String(redeemPoints) } : {}),
      ...(affiliateRef ? { affiliate_ref: affiliateRef } : {}),
    },
  });

  return json({ url: session.url });
}
