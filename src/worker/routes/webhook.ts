import type { ProductRow, RequestContext, TierKey } from '../types';
import { TIERS } from '../types';
import { json, errorResponse, newId } from '../lib/util';
import { verifyStripeSignature, stripeRequest } from '../lib/stripe';
import { sendEmail, orderConfirmationEmail, subscriptionConfirmationEmail } from '../lib/email';
import { defaultBoxItems } from './products';

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

/** Stripe webhook: order creation + subscription lifecycle. */
export async function stripeWebhook(req: Request, rc: RequestContext): Promise<Response> {
  const payload = await req.text();
  const valid = await verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), rc.env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return errorResponse('Invalid signature', 400);

  const event = JSON.parse(payload) as StripeEvent;
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(rc, event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(rc, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await rc.env.DB.prepare("UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = ?")
          .bind(event.data.object.id)
          .run();
        break;
      case 'invoice.paid': {
        const subId = event.data.object.subscription;
        const periodEnd = event.data.object.lines?.data?.[0]?.period?.end;
        if (subId && periodEnd) {
          await rc.env.DB.prepare(
            "UPDATE subscriptions SET next_billing_date = ?, status = 'active' WHERE stripe_subscription_id = ?"
          )
            .bind(new Date(periodEnd * 1000).toISOString(), subId)
            .run();
        }
        break;
      }
      case 'invoice.payment_failed': {
        const subId = event.data.object.subscription;
        if (subId) {
          await rc.env.DB.prepare("UPDATE subscriptions SET status = 'past_due' WHERE stripe_subscription_id = ?")
            .bind(subId)
            .run();
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Webhook handler failed for ${event.type}:`, err);
    return errorResponse('Webhook handler failed', 500); // Stripe retries on 5xx
  }
  return json({ received: true });
}

async function handleCheckoutCompleted(rc: RequestContext, session: Record<string, any>): Promise<void> {
  if (session.mode === 'payment') return createOrderFromSession(rc, session);
  if (session.mode === 'subscription') return createSubscriptionFromSession(rc, session);
}

async function createOrderFromSession(rc: RequestContext, session: Record<string, any>): Promise<void> {
  const orderId = newId('o');
  const email: string | null = session.customer_details?.email ?? session.customer_email ?? null;
  const userId: string | null = session.metadata?.user_id ?? null;

  // Idempotency: skip if we already recorded this payment.
  const existing = await rc.env.DB.prepare('SELECT id FROM orders WHERE stripe_payment_intent = ?')
    .bind(session.payment_intent ?? session.id)
    .first();
  if (existing) return;

  const cart: { p: string; q: number }[] = JSON.parse(session.metadata?.cart ?? '[]');
  const ids = cart.map((c) => c.p);
  let products: ProductRow[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    products = (
      await rc.env.DB.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).bind(...ids).all<ProductRow>()
    ).results;
  }
  const byId = new Map(products.map((p) => [p.id, p]));

  const statements = [
    rc.env.DB.prepare(
      "INSERT INTO orders (id, user_id, email, stripe_payment_intent, total, status) VALUES (?, ?, ?, ?, ?, 'paid')"
    ).bind(orderId, userId, email, session.payment_intent ?? session.id, session.amount_total ?? 0),
    ...cart
      .filter((c) => byId.has(c.p))
      .map((c) =>
        rc.env.DB.prepare(
          'INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?)'
        ).bind(orderId, c.p, c.q, byId.get(c.p)!.price)
      ),
  ];
  await rc.env.DB.batch(statements);

  if (email) {
    const items = cart.map((c) => ({ name: byId.get(c.p)?.name ?? 'Item', quantity: c.q }));
    rc.ctx.waitUntil(
      sendEmail(rc.env, email, 'Your Flavor Doctors prescription has been filled', orderConfirmationEmail(items, session.amount_total ?? 0))
    );
  }
}

async function createSubscriptionFromSession(rc: RequestContext, session: Record<string, any>): Promise<void> {
  const stripeSubId: string | null = session.subscription ?? null;
  const tierKey = (session.metadata?.tier ?? 'starter') as TierKey;
  const tier = TIERS[tierKey] ?? TIERS.starter;
  const userId: string | null = session.metadata?.user_id ?? null;
  if (!stripeSubId || !userId) return;

  const existing = await rc.env.DB.prepare('SELECT id FROM subscriptions WHERE stripe_subscription_id = ?')
    .bind(stripeSubId)
    .first();
  if (existing) return;

  // Next billing date from the Stripe subscription object.
  let nextBilling: string | null = null;
  try {
    const sub = await stripeRequest<{ current_period_end?: number }>(rc.env, 'GET', `/v1/subscriptions/${stripeSubId}`);
    if (sub.current_period_end) nextBilling = new Date(sub.current_period_end * 1000).toISOString();
  } catch (err) {
    console.error('Could not fetch subscription from Stripe:', err);
  }

  // Default box = best-sellers until the user customizes.
  const items = await defaultBoxItems(rc, tier.items);
  await rc.env.DB.prepare(
    "INSERT INTO subscriptions (id, user_id, stripe_subscription_id, tier, status, items_json, next_billing_date) VALUES (?, ?, ?, ?, 'active', ?, ?)"
  )
    .bind(newId('s'), userId, stripeSubId, tierKey, JSON.stringify(items), nextBilling)
    .run();

  const email: string | null = session.customer_details?.email ?? null;
  if (email) {
    rc.ctx.waitUntil(
      sendEmail(rc.env, email, `Welcome to the ${tier.name} Monthly Rx Box`, subscriptionConfirmationEmail(tier.name, tier.items))
    );
  }
}

async function handleSubscriptionUpdated(rc: RequestContext, sub: Record<string, any>): Promise<void> {
  const status = ['active', 'trialing'].includes(sub.status)
    ? 'active'
    : sub.status === 'past_due'
      ? 'past_due'
      : ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)
        ? 'canceled'
        : 'incomplete';
  const nextBilling = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  await rc.env.DB.prepare(
    'UPDATE subscriptions SET status = ?, next_billing_date = COALESCE(?, next_billing_date) WHERE stripe_subscription_id = ?'
  )
    .bind(status, nextBilling, sub.id)
    .run();
}
