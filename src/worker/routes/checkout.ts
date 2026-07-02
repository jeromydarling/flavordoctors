import type { ProductRow, RequestContext } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { stripeRequest, ensureStripeCustomer } from '../lib/stripe';
import { getAuthUser } from '../lib/auth';

interface CartItem {
  productId: string;
  quantity: number;
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
  const origin = new URL(req.url).origin;

  // Compact cart stored in metadata (< 500 chars) so the webhook can build the order.
  const cartMeta = JSON.stringify(items.map((i) => ({ p: i.productId, q: i.quantity })));

  const session = await stripeRequest<{ id: string; url: string }>(rc.env, 'POST', '/v1/checkout/sessions', {
    mode: 'payment',
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel`,
    ...(user
      ? { customer: await ensureStripeCustomer(rc.env, user.id, user.email) }
      : { customer_creation: 'always' }),
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
