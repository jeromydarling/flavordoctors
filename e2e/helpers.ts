import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';

export const WEBHOOK_SECRET = 'whsec_dummy'; // matches .dev.vars for local runs

/** Read a var from .dev.vars so specs match whatever secret the worker runs with. */
export function devVar(name: string): string {
  const line = readFileSync('.dev.vars', 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} not found in .dev.vars`);
  return line.slice(name.length + 1).trim();
}

/** Mirror of the worker's NPS link signature (HMAC-SHA256, first 8 bytes hex). */
export function npsSig(orderId: string, email: string): string {
  return createHmac('sha256', devVar('JWT_SECRET')).update(`nps:${orderId}:${email}`).digest('hex').slice(0, 16);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}@e2e.test`;
}

/** Send a signed Stripe webhook event to the local worker. */
export async function sendWebhook(request: APIRequestContext, event: object): Promise<number> {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  const res = await request.post('/api/webhooks/stripe', {
    headers: { 'Stripe-Signature': `t=${t},v1=${v1}`, 'Content-Type': 'application/json' },
    data: payload,
  });
  return res.status();
}

export async function registerViaUi(page: Page, email: string, password = 'password-e2e-1'): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL('**/account');
}

/** Register the user, or fall back to login when the account already exists (rerun-safe). */
export async function ensureUser(page: Page, email: string, password = 'password-e2e-1'): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create Account' }).click();
  // Wait for either outcome without leaving a pending assertion behind.
  await page
    .locator('h1:has-text("My Chart"), p:has-text("already exists")')
    .first()
    .waitFor({ timeout: 15_000 });
  if (await page.getByText('already exists', { exact: false }).isVisible()) {
    await loginViaUi(page, email, password);
  }
}

export async function loginViaUi(page: Page, email: string, password = 'password-e2e-1'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/account');
}

/** Current user id, read via the API using the page's cookies. */
export async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/me');
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

export function orderPaidEvent(
  userId: string | null,
  email: string,
  cart: { p: string; q: number }[],
  totalCents: number,
  opts: { redeemPoints?: number } = {}
) {
  const ref = `pi_e2e_${randomBytes(5).toString('hex')}`;
  return {
    id: `evt_e2e_${ref}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_e2e_${ref}`,
        mode: 'payment',
        payment_intent: ref,
        amount_total: totalCents,
        customer_details: { email },
        metadata: {
          kind: 'order',
          cart: JSON.stringify(cart),
          ...(userId ? { user_id: userId } : {}),
          ...(opts.redeemPoints ? { redeem_points: String(opts.redeemPoints) } : {}),
        },
      },
    },
  };
}

export function subscriptionCreatedEvent(userId: string, email: string, tier: string, cadence = 'monthly') {
  const ref = `sub_e2e_${randomBytes(5).toString('hex')}`;
  return {
    id: `evt_e2e_${ref}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_e2e_${ref}`,
        mode: 'subscription',
        subscription: ref,
        amount_total: 5400,
        customer_details: { email },
        metadata: { kind: 'subscription', tier, cadence, user_id: userId },
      },
    },
  };
}
