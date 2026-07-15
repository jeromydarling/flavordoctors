import type { SubscriptionRow, TierKey, CadenceKey } from '../types';
import { TIERS, CADENCES, LIVE_SUB_STATUSES, FIRST_BOX_COUPON } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { stripeRequest, ensureStripeCustomer, ensureCoupon } from '../lib/stripe';
import { requireAuth } from '../lib/auth';

const LIVE = LIVE_SUB_STATUSES.map(() => '?').join(',');

/** Start a Monthly Rx Box subscription via Stripe Checkout (auth required). */
export const createSubscription = requireAuth(async (req, rc) => {
  const body = await readJson<{ tier?: string; cadence?: string; affiliateRef?: string }>(req);
  const affiliateRef = /^hc_[a-z0-9]{1,40}$/.test(body?.affiliateRef ?? '') ? body!.affiliateRef! : null;
  const tierKey = body?.tier as TierKey | undefined;
  if (!tierKey || !(tierKey in TIERS)) return errorResponse('Unknown subscription tier');
  const cadenceKey = (body?.cadence ?? 'monthly') as CadenceKey;
  if (!(cadenceKey in CADENCES)) return errorResponse('Unknown cadence');
  const tier = TIERS[tierKey];
  const cadence = CADENCES[cadenceKey];
  const user = rc.user!;

  const existing = await rc.env.DB.prepare(
    `SELECT id FROM subscriptions WHERE user_id = ? AND status IN (${LIVE})`
  )
    .bind(user.id, ...LIVE_SUB_STATUSES)
    .first();
  if (existing) return errorResponse('You already have an active subscription. Manage it from your account.', 409);

  // First-box 20% off for brand-new subscribers (never had a subscription).
  const everSubscribed = await rc.env.DB.prepare('SELECT id FROM subscriptions WHERE user_id = ? LIMIT 1')
    .bind(user.id)
    .first();
  let discounts: { coupon: string }[] | undefined;
  if (!everSubscribed) {
    try {
      discounts = [
        { coupon: await ensureCoupon(rc.env, FIRST_BOX_COUPON.id, FIRST_BOX_COUPON.percentOff, FIRST_BOX_COUPON.name) },
      ];
    } catch (err) {
      console.error('First-box coupon unavailable, continuing without discount:', err);
    }
  }

  const customerId = await ensureStripeCustomer(rc.env, user.id, user.email);
  const origin = new URL(req.url).origin;

  const session = await stripeRequest<{ id: string; url: string }>(rc.env, 'POST', '/v1/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    success_url: `${origin}/account/customize?welcome=1`,
    cancel_url: `${origin}/subscribe`,
    shipping_address_collection: { allowed_countries: ['US'] },
    // Enable after activating Stripe Tax in the dashboard (set STRIPE_TAX_ENABLED="1").
    ...(rc.env.STRIPE_TAX_ENABLED === '1'
      ? { automatic_tax: { enabled: true }, customer_update: { shipping: 'auto' } }
      : {}),
    ...(discounts ? { discounts } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: tier.price * cadence.priceMultiplier,
          recurring: { interval: 'month', interval_count: cadence.intervalCount },
          product_data: {
            name: `Flavor Doctors Rx Box — ${tier.name} (${cadence.label})`,
            description:
              cadenceKey === 'annual'
                ? `${tier.items} doctored items monthly — 12 boxes billed annually, 2 months free`
                : `${tier.items} doctored items, delivered ${cadence.label.toLowerCase()}`,
          },
        },
      },
    ],
    metadata: {
      kind: 'subscription',
      tier: tierKey,
      cadence: cadenceKey,
      user_id: user.id,
      ...(affiliateRef ? { affiliate_ref: affiliateRef } : {}),
    },
    subscription_data: {
      metadata: { tier: tierKey, cadence: cadenceKey, user_id: user.id },
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

  const sub = await liveSubscription(rc, rc.user!.id);
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

/** Skip the next box: void collection for exactly one billing period. */
export const skipNextBox = requireAuth(async (_req, rc) => {
  const sub = await liveSubscription(rc, rc.user!.id);
  if (!sub?.stripe_subscription_id) return errorResponse('No active subscription found', 404);

  const stripeSub = await stripeRequest<{ current_period_end?: number; pause_collection?: unknown }>(
    rc.env,
    'GET',
    `/v1/subscriptions/${sub.stripe_subscription_id}`
  );
  if (stripeSub.pause_collection) return errorResponse('Your subscription is already paused');
  if (!stripeSub.current_period_end) return errorResponse('Could not determine your billing period', 500);

  // Void the invoice at the end of this period; billing resumes on the following cycle.
  const resumesAt = stripeSub.current_period_end + 60;
  await stripeRequest(rc.env, 'POST', `/v1/subscriptions/${sub.stripe_subscription_id}`, {
    pause_collection: { behavior: 'void', resumes_at: resumesAt },
  });
  await rc.env.DB.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(sub.id).run();
  return json({ ok: true, resumesAt: new Date(resumesAt * 1000).toISOString() });
});

/** Pause the subscription for 1-3 months. */
export const pauseSubscription = requireAuth(async (req, rc) => {
  const body = await readJson<{ months?: number }>(req);
  const months = body?.months;
  if (!Number.isInteger(months) || months! < 1 || months! > 3) {
    return errorResponse('months must be 1, 2, or 3');
  }
  const sub = await liveSubscription(rc, rc.user!.id);
  if (!sub?.stripe_subscription_id) return errorResponse('No active subscription found', 404);

  const resumesAt = Math.floor(Date.now() / 1000) + months! * 30 * 86400;
  await stripeRequest(rc.env, 'POST', `/v1/subscriptions/${sub.stripe_subscription_id}`, {
    pause_collection: { behavior: 'void', resumes_at: resumesAt },
  });
  await rc.env.DB.prepare("UPDATE subscriptions SET status = 'paused' WHERE id = ?").bind(sub.id).run();
  return json({ ok: true, resumesAt: new Date(resumesAt * 1000).toISOString() });
});

/** Resume a paused subscription immediately. */
export const resumeSubscription = requireAuth(async (_req, rc) => {
  const sub = await liveSubscription(rc, rc.user!.id);
  if (!sub?.stripe_subscription_id) return errorResponse('No subscription found', 404);
  await stripeRequest(rc.env, 'POST', `/v1/subscriptions/${sub.stripe_subscription_id}`, {
    pause_collection: '',
  });
  await rc.env.DB.prepare("UPDATE subscriptions SET status = 'active' WHERE id = ?").bind(sub.id).run();
  return json({ ok: true });
});

const SAVE_COUPON = { id: 'FD_SAVE_20', percentOff: 20, name: 'Stay with us — 20% off your next box' };

async function trackSaveOffer(rc: { env: { DB: D1Database } }, userId: string, action: string): Promise<void> {
  await rc.env.DB.prepare('INSERT INTO save_offer_events (user_id, action) VALUES (?, ?)').bind(userId, action).run();
}

/** Cancel-flow save offer: 20% off the next box, once per customer ever. */
export const saveOfferDiscount = requireAuth(async (_req, rc) => {
  const sub = await liveSubscription(rc, rc.user!.id);
  if (!sub?.stripe_subscription_id) return errorResponse('No active subscription found', 404);
  const used = await rc.env.DB.prepare(
    "SELECT 1 FROM save_offer_events WHERE user_id = ? AND action = 'discount' LIMIT 1"
  )
    .bind(rc.user!.id)
    .first();
  if (used) return errorResponse('The stay-with-us discount can only be claimed once', 409);

  await ensureCoupon(rc.env, SAVE_COUPON.id, SAVE_COUPON.percentOff, SAVE_COUPON.name);
  await stripeRequest(rc.env, 'POST', `/v1/subscriptions/${sub.stripe_subscription_id}`, {
    discounts: [{ coupon: SAVE_COUPON.id }],
  });
  await trackSaveOffer(rc, rc.user!.id, 'discount');
  return json({ ok: true, percentOff: SAVE_COUPON.percentOff });
});

/** Cancel at period end (with undo) — the box stays active until it lapses. */
export const cancelSubscription = requireAuth(async (req, rc) => {
  const body = await readJson<{ undo?: boolean }>(req);
  const undo = body?.undo === true;
  const sub = await liveSubscription(rc, rc.user!.id);
  if (!sub?.stripe_subscription_id) return errorResponse('No active subscription found', 404);

  const updated = await stripeRequest<{ current_period_end?: number }>(
    rc.env,
    'POST',
    `/v1/subscriptions/${sub.stripe_subscription_id}`,
    { cancel_at_period_end: undo ? 'false' : 'true' }
  );
  await rc.env.DB.prepare('UPDATE subscriptions SET cancel_at_period_end = ? WHERE id = ?')
    .bind(undo ? 0 : 1, sub.id)
    .run();
  await trackSaveOffer(rc, rc.user!.id, undo ? 'undo_cancel' : 'cancel');
  return json({
    ok: true,
    cancelAtPeriodEnd: !undo,
    periodEnd: updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null,
  });
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

async function liveSubscription(
  rc: { env: { DB: D1Database } },
  userId: string
): Promise<SubscriptionRow | null> {
  return rc.env.DB.prepare(
    `SELECT * FROM subscriptions WHERE user_id = ? AND status IN (${LIVE}) ORDER BY created_at DESC LIMIT 1`
  )
    .bind(userId, ...LIVE_SUB_STATUSES)
    .first<SubscriptionRow>();
}

export function serializeSubscription(sub: SubscriptionRow) {
  const tier = TIERS[sub.tier as TierKey];
  const cadence = CADENCES[(sub.cadence ?? 'monthly') as CadenceKey] ?? CADENCES.monthly;
  return {
    id: sub.id,
    tier: sub.tier,
    tierName: tier?.name ?? sub.tier,
    itemsPerMonth: tier?.items ?? null,
    priceMonthly: tier?.price ?? null,
    cadence: sub.cadence ?? 'monthly',
    cadenceLabel: cadence.label,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end === 1,
    items: sub.items_json ? (JSON.parse(sub.items_json) as string[]) : [],
    nextBillingDate: sub.next_billing_date,
  };
}
