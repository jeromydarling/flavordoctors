import type { SubscriptionRow, TierKey } from '../types';
import { TIERS } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { stripeRequest, ensureStripeCustomer } from '../lib/stripe';
import { requireAuth } from '../lib/auth';

/** Start a Monthly Rx Box subscription via Stripe Checkout (auth required). */
export const createSubscription = requireAuth(async (req, rc) => {
  const body = await readJson<{ tier?: string }>(req);
  const tierKey = body?.tier as TierKey | undefined;
  if (!tierKey || !(tierKey in TIERS)) return errorResponse('Unknown subscription tier');
  const tier = TIERS[tierKey];
  const user = rc.user!;

  const existing = await rc.env.DB.prepare(
    "SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active', 'past_due')"
  )
    .bind(user.id)
    .first();
  if (existing) return errorResponse('You already have an active subscription. Manage it from your account.', 409);

  const customerId = await ensureStripeCustomer(rc.env, user.id, user.email);
  const origin = new URL(req.url).origin;

  const session = await stripeRequest<{ id: string; url: string }>(rc.env, 'POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    success_url: `${origin}/account/customize?welcome=1`,
    cancel_url: `${origin}/subscribe`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: tier.price,
          recurring: { interval: 'month' },
          product_data: {
            name: `Flavor Doctors Monthly Rx Box — ${tier.name}`,
            description: `${tier.items} doctored items delivered monthly`,
          },
        },
      },
    ],
    metadata: { kind: 'subscription', tier: tierKey, user_id: user.id },
    subscription_data: {
      metadata: { tier: tierKey, user_id: user.id },
    },
  });

  return json({ url: session.url });
});

/** The user's current subscription (active or most recent). */
export const getMySubscription = requireAuth(async (_req, rc) => {
  const sub = await rc.env.DB.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  )
    .bind(rc.user!.id)
    .first<SubscriptionRow>();
  if (!sub) return json({ subscription: null });
  return json({ subscription: serializeSubscription(sub) });
});

/** Update which products are in the monthly box. */
export const updateBoxItems = requireAuth(async (req, rc) => {
  const body = await readJson<{ items?: string[] }>(req);
  const items = body?.items;
  if (!Array.isArray(items) || items.some((i) => typeof i !== 'string')) {
    return errorResponse('items must be an array of product ids');
  }

  const sub = await rc.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active', 'past_due') ORDER BY created_at DESC LIMIT 1"
  )
    .bind(rc.user!.id)
    .first<SubscriptionRow>();
  if (!sub) return errorResponse('No active subscription found', 404);

  const tier = TIERS[sub.tier as TierKey];
  const maxItems = tier?.items ?? 8;
  const unique = [...new Set(items)];
  if (unique.length !== maxItems) {
    return errorResponse(`Your ${tier?.name ?? 'plan'} box holds exactly ${maxItems} unique items`);
  }

  const placeholders = unique.map(() => '?').join(',');
  const { results } = await rc.env.DB.prepare(
    `SELECT id FROM products WHERE id IN (${placeholders}) AND is_active = 1`
  )
    .bind(...unique)
    .all<{ id: string }>();
  if (results.length !== unique.length) return errorResponse('One or more selected products are unavailable');

  await rc.env.DB.prepare('UPDATE subscriptions SET items_json = ? WHERE id = ?')
    .bind(JSON.stringify(unique), sub.id)
    .run();
  return json({ ok: true, items: unique });
});

/** Stripe Customer Portal session for billing management. */
export const createPortalSession = requireAuth(async (req, rc) => {
  const customerId = await ensureStripeCustomer(rc.env, rc.user!.id, rc.user!.email);
  const origin = new URL(req.url).origin;
  const session = await stripeRequest<{ url: string }>(rc.env, 'POST', '/v1/billing_portal/sessions', {
    customer: customerId,
    return_url: `${origin}/account`,
  });
  return json({ url: session.url });
});

export function serializeSubscription(sub: SubscriptionRow) {
  const tier = TIERS[sub.tier as TierKey];
  return {
    id: sub.id,
    tier: sub.tier,
    tierName: tier?.name ?? sub.tier,
    itemsPerMonth: tier?.items ?? null,
    priceMonthly: tier?.price ?? null,
    status: sub.status,
    items: sub.items_json ? (JSON.parse(sub.items_json) as string[]) : [],
    nextBillingDate: sub.next_billing_date,
  };
}
