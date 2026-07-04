import type { ProductRow, RequestContext, TierKey } from '../types';
import { TIERS, REFERRAL_POINTS, POINT_VALUE_CENTS } from '../types';
import { json, errorResponse, newId } from '../lib/util';
import { verifyStripeSignature, stripeRequest } from '../lib/stripe';
import { sendEmail, orderConfirmationEmail, subscriptionConfirmationEmail } from '../lib/email';
import { upsertContact } from '../lib/marketing';
import { consumeStock } from '../lib/inventory';
import { type AffiliateRow, recordCommission, clawbackCommission, RECURRING_MONTHS } from '../lib/affiliates';
import { defaultBoxItems } from './products';
import type { Env } from '../types';

/** Server-side GA4 purchase event (Measurement Protocol) — ad-blocker-proof revenue. */
async function ga4Purchase(env: Env, email: string, transactionId: string, valueCents: number): Promise<void> {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
    const clientId = `${digest[0] * 16777216 + digest[1] * 65536 + digest[2] * 256 + digest[3]}.${digest[4] * 16777216 + digest[5] * 65536 + digest[6] * 256 + digest[7]}`;
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [
            { name: 'purchase', params: { transaction_id: transactionId, value: valueCents / 100, currency: 'USD' } },
          ],
        }),
      }
    );
  } catch (err) {
    console.error('GA4 purchase event failed:', err);
  }
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

/** Stripe webhook: order creation + subscription lifecycle + loyalty points. */
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
        const invoice = event.data.object;
        const subId = invoice.subscription;
        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        if (subId && periodEnd) {
          await rc.env.DB.prepare(
            "UPDATE subscriptions SET next_billing_date = ?, status = 'active' WHERE stripe_subscription_id = ? AND status != 'paused'"
          )
            .bind(new Date(periodEnd * 1000).toISOString(), subId)
            .run();
        }
        // Affiliate recurring commission: renewals within the subscriber's
        // first year earn the originating affiliate their recurring rate.
        if (subId && invoice.billing_reason && invoice.billing_reason !== 'subscription_create' && invoice.amount_paid > 0) {
          try {
            const sub = await rc.env.DB.prepare(
              `SELECT affiliate_id, created_at FROM subscriptions WHERE stripe_subscription_id = ?
               AND affiliate_id IS NOT NULL AND created_at > datetime('now', '-${RECURRING_MONTHS} months')`
            )
              .bind(subId)
              .first<{ affiliate_id: string }>();
            if (sub?.affiliate_id) {
              const aff = await rc.env.DB.prepare("SELECT * FROM affiliates WHERE id = ? AND status = 'approved'")
                .bind(sub.affiliate_id)
                .first<AffiliateRow>();
              if (aff) await recordCommission(rc.env, aff, 'recurring', invoice.amount_paid, invoice.id, null);
            }
          } catch (err) {
            console.error('Affiliate recurring commission failed:', err);
          }
        }
        // Renewal boxes ship out of inventory (the first box is consumed at
        // checkout, so skip the subscription_create invoice).
        if (subId && invoice.billing_reason && invoice.billing_reason !== 'subscription_create') {
          const box = await rc.env.DB.prepare(
            'SELECT items_json FROM subscriptions WHERE stripe_subscription_id = ?'
          )
            .bind(subId)
            .first<{ items_json: string }>();
          if (box) {
            try {
              const items = JSON.parse(box.items_json) as string[];
              await consumeStock(rc.env, 'subscription', invoice.id, items.map((id) => ({ productId: id, qty: 1 })));
            } catch (err) {
              console.error('Renewal inventory consume failed:', err);
            }
          }
        }
        // Loyalty: 1 point per $ on subscription invoices.
        if (subId && invoice.amount_paid > 0) {
          const sub = await rc.env.DB.prepare('SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ?')
            .bind(subId)
            .first<{ user_id: string }>();
          if (sub) {
            await rc.env.DB.prepare(
              "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'invoice', ?)"
            )
              .bind(sub.user_id, Math.floor(invoice.amount_paid / 100), invoice.id)
              .run();
          }
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
      case 'charge.refunded': {
        const paymentIntent = event.data.object.payment_intent;
        if (paymentIntent) {
          // Mark the order and claw back any affiliate commission it earned.
          await rc.env.DB.prepare("UPDATE orders SET status = 'refunded' WHERE stripe_payment_intent = ?")
            .bind(paymentIntent)
            .run();
          await clawbackCommission(rc.env, paymentIntent);
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
  const paymentRef: string = session.payment_intent ?? session.id;

  // Idempotency: skip if we already recorded this payment.
  const existing = await rc.env.DB.prepare('SELECT id FROM orders WHERE stripe_payment_intent = ?')
    .bind(paymentRef)
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
    ).bind(orderId, userId, email, paymentRef, session.amount_total ?? 0),
    ...cart
      .filter((c) => byId.has(c.p))
      .map((c) =>
        rc.env.DB.prepare(
          'INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?)'
        ).bind(orderId, c.p, c.q, byId.get(c.p)!.price)
      ),
    // Decrement limited-drop stock.
    ...cart
      .filter((c) => byId.get(c.p)?.is_drop === 1 && byId.get(c.p)?.drop_stock !== null)
      .map((c) =>
        rc.env.DB.prepare('UPDATE products SET drop_stock = MAX(0, drop_stock - ?) WHERE id = ?').bind(c.q, c.p)
      ),
  ];
  // Loyalty: 1 point per $ spent.
  if (userId && (session.amount_total ?? 0) > 0) {
    statements.push(
      rc.env.DB.prepare(
        "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'order', ?)"
      ).bind(userId, Math.floor((session.amount_total ?? 0) / 100), paymentRef)
    );
  }
  // Redeemed points come off the balance only now that the payment landed.
  const redeemPoints = parseInt(session.metadata?.redeem_points ?? '0', 10);
  if (userId && redeemPoints > 0) {
    statements.push(
      rc.env.DB.prepare(
        "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'redeem', ?)"
      ).bind(userId, -redeemPoints, paymentRef)
    );
  }
  await rc.env.DB.batch(statements);

  if (email) rc.ctx.waitUntil(referralRewards(rc, email, userId, paymentRef));

  // Affiliate attribution: explicit code beats the ?aff= link ref.
  await attributeOrder(rc, orderId, session, email, paymentRef);

  // Ship the order out of inventory, FEFO. Idempotent per order id.
  await consumeStock(
    rc.env,
    'order',
    orderId,
    cart.filter((c) => byId.has(c.p)).map((c) => ({ productId: c.p, qty: c.q }))
  );

  if (email) {
    const items = cart.map((c) => ({ name: byId.get(c.p)?.name ?? 'Item', quantity: c.q }));
    rc.ctx.waitUntil(
      sendEmail(rc.env, email, 'Your Flavor Doctors prescription has been filled', orderConfirmationEmail(items, session.amount_total ?? 0))
    );
    rc.ctx.waitUntil(upsertContact(rc.env, email, { source: 'checkout', userId: userId ?? undefined }));
    rc.ctx.waitUntil(ga4Purchase(rc.env, email, orderId, session.amount_total ?? 0));
  }
}

/** Resolve the affiliate behind a checkout session: promo code first, link ref second. */
async function resolveAffiliate(rc: RequestContext, session: Record<string, any>): Promise<AffiliateRow | null> {
  // Code-based attribution: our affiliate promo codes carry affiliate_id metadata.
  if ((session.total_details?.amount_discount ?? 0) > 0 && session.id) {
    try {
      const expanded = await stripeRequest<{
        total_details?: { breakdown?: { discounts?: { discount?: { promotion_code?: string } }[] } };
      }>(rc.env, 'GET', `/v1/checkout/sessions/${session.id}?expand[]=total_details.breakdown`);
      const promoId = expanded.total_details?.breakdown?.discounts?.[0]?.discount?.promotion_code;
      if (promoId) {
        const promo = await stripeRequest<{ metadata?: { affiliate_id?: string } }>(rc.env, 'GET', `/v1/promotion_codes/${promoId}`);
        if (promo.metadata?.affiliate_id) {
          const aff = await rc.env.DB.prepare("SELECT * FROM affiliates WHERE id = ? AND status = 'approved'")
            .bind(promo.metadata.affiliate_id)
            .first<AffiliateRow>();
          if (aff) return aff;
        }
      }
    } catch (err) {
      console.error('Affiliate code attribution lookup failed (falling back to link ref):', err);
    }
  }
  const ref = session.metadata?.affiliate_ref;
  if (ref && /^hc_[a-z0-9]{1,40}$/.test(ref)) {
    return rc.env.DB.prepare("SELECT * FROM affiliates WHERE ref_code = ? AND status = 'approved'")
      .bind(ref)
      .first<AffiliateRow>();
  }
  return null;
}

/** Attribute a paid order to its affiliate and record the first-order commission. */
async function attributeOrder(
  rc: RequestContext,
  orderId: string,
  session: Record<string, any>,
  email: string | null,
  paymentRef: string
): Promise<void> {
  try {
    const aff = await resolveAffiliate(rc, session);
    if (!aff) return;
    if (email && aff.email.toLowerCase() === email.toLowerCase()) return; // self-purchase earns nothing
    await rc.env.DB.prepare('UPDATE orders SET affiliate_id = ? WHERE id = ?').bind(aff.id, orderId).run();

    // Commission on the buyer's FIRST order only, shipping excluded.
    const orders = await rc.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE email = ? AND status != 'canceled'")
      .bind(email)
      .first<{ n: number }>();
    if (email && (orders?.n ?? 0) === 1) {
      const base = (session.amount_total ?? 0) - (session.total_details?.amount_shipping ?? 0);
      await recordCommission(rc.env, aff, 'first_order', base, paymentRef, orderId);
    }
  } catch (err) {
    console.error('Affiliate attribution failed:', err);
  }
}

/**
 * Refer-a-Patient: when a referred customer's FIRST order is paid, both sides
 * earn points. Idempotent per payment via the ledger's (reason, ref) index.
 */
async function referralRewards(rc: RequestContext, email: string, buyerUserId: string | null, paymentRef: string): Promise<void> {
  try {
    const contact = await rc.env.DB.prepare('SELECT referred_by FROM contacts WHERE email = ?')
      .bind(email)
      .first<{ referred_by: string | null }>();
    if (!contact?.referred_by) return;
    const orders = await rc.env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE email = ? AND status != 'canceled'")
      .bind(email)
      .first<{ n: number }>();
    if ((orders?.n ?? 0) !== 1) return; // reward first orders only

    const referrer = await rc.env.DB.prepare(
      `SELECT c.email, COALESCE(c.user_id, u.id) AS user_id FROM contacts c
       LEFT JOIN users u ON u.email = c.email WHERE c.ref_code = ?`
    )
      .bind(contact.referred_by)
      .first<{ email: string; user_id: string | null }>();
    if (!referrer || referrer.email === email) return; // unknown code or self-referral

    const statements = [];
    if (referrer.user_id) {
      statements.push(
        rc.env.DB.prepare(
          "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'referral', ?)"
        ).bind(referrer.user_id, REFERRAL_POINTS, paymentRef)
      );
    }
    if (buyerUserId) {
      statements.push(
        rc.env.DB.prepare(
          "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'referral_welcome', ?)"
        ).bind(buyerUserId, REFERRAL_POINTS, paymentRef)
      );
    }
    if (statements.length > 0) await rc.env.DB.batch(statements);
    if (referrer.user_id) {
      await sendEmail(
        rc.env,
        referrer.email,
        'Your referral filled their first prescription 🩺',
        `<h2>House call successful!</h2><p>Someone you referred just placed their first order, so <strong>${REFERRAL_POINTS} Board Certification points</strong> (worth $${((REFERRAL_POINTS * POINT_VALUE_CENTS) / 100).toFixed(2)}) were added to your chart.</p><p><a href="https://flavordoctors.com/account" style="color:#27AE60;font-weight:bold;">See your balance →</a></p>`
      );
    }
  } catch (err) {
    console.error('Referral reward failed:', err);
  }
}

async function createSubscriptionFromSession(rc: RequestContext, session: Record<string, any>): Promise<void> {
  const stripeSubId: string | null = session.subscription ?? null;
  const tierKey = (session.metadata?.tier ?? 'starter') as TierKey;
  const tier = TIERS[tierKey] ?? TIERS.starter;
  const cadence: string = ['bimonthly', 'annual'].includes(session.metadata?.cadence)
    ? session.metadata.cadence
    : 'monthly';
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
  const subId = newId('s');
  await rc.env.DB.prepare(
    "INSERT INTO subscriptions (id, user_id, stripe_subscription_id, tier, status, cadence, items_json, next_billing_date) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)"
  )
    .bind(subId, userId, stripeSubId, tierKey, cadence, JSON.stringify(items), nextBilling)
    .run();

  // Affiliate attribution: the originating affiliate earns on the first box
  // now and on renewals (via invoice.paid) for the subscriber's first year.
  try {
    const aff = await resolveAffiliate(rc, session);
    const email: string | null = session.customer_details?.email ?? null;
    if (aff && (!email || aff.email.toLowerCase() !== email.toLowerCase())) {
      await rc.env.DB.prepare('UPDATE subscriptions SET affiliate_id = ? WHERE id = ?').bind(aff.id, subId).run();
      await recordCommission(rc.env, aff, 'first_order', session.amount_total ?? 0, session.id, null);
    }
  } catch (err) {
    console.error('Affiliate subscription attribution failed:', err);
  }

  // First box ships now; renewals are consumed on invoice.paid (subscription_cycle).
  await consumeStock(rc.env, 'subscription', session.id, items.map((id) => ({ productId: id, qty: 1 })));

  // Loyalty points for the first subscription payment.
  if ((session.amount_total ?? 0) > 0) {
    await rc.env.DB.prepare(
      "INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref) VALUES (?, ?, 'order', ?)"
    )
      .bind(userId, Math.floor((session.amount_total ?? 0) / 100), session.id)
      .run();
  }

  const email: string | null = session.customer_details?.email ?? null;
  if (email) {
    rc.ctx.waitUntil(
      sendEmail(rc.env, email, `Welcome to the ${tier.name} Rx Box`, subscriptionConfirmationEmail(tier.name, tier.items))
    );
  }
}

async function handleSubscriptionUpdated(rc: RequestContext, sub: Record<string, any>): Promise<void> {
  const paused = !!sub.pause_collection;
  const status = paused
    ? 'paused'
    : ['active', 'trialing'].includes(sub.status)
      ? 'active'
      : sub.status === 'past_due'
        ? 'past_due'
        : ['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)
          ? 'canceled'
          : 'incomplete';
  const nextBilling = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  await rc.env.DB.prepare(
    'UPDATE subscriptions SET status = ?, cancel_at_period_end = ?, next_billing_date = COALESCE(?, next_billing_date) WHERE stripe_subscription_id = ?'
  )
    .bind(status, sub.cancel_at_period_end ? 1 : 0, nextBilling, sub.id)
    .run();
}
