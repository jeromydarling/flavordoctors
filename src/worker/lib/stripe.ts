import type { Env } from '../types';
import { timingSafeEqual } from './util';

const STRIPE_API = 'https://api.stripe.com';

/**
 * Minimal Stripe REST client for Workers (no SDK dependency).
 * Params are flattened into Stripe's form encoding, e.g.
 * { line_items: [{ price_data: { currency: 'usd' } }] }
 * -> line_items[0][price_data][currency]=usd
 */
function flattenParams(obj: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenParams(v, `${prefix}[${i}]`, out));
  } else if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      flattenParams(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.push([prefix, String(obj)]);
  }
  return out;
}

export interface StripeError extends Error {
  status: number;
  stripeCode?: string;
  isStripeError: true;
}

export function isStripeError(err: unknown): err is StripeError {
  return err instanceof Error && (err as StripeError).isStripeError === true;
}

export async function stripeRequest<T = Record<string, unknown>>(
  env: Env,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params?: Record<string, unknown>
): Promise<T> {
  let url = `${STRIPE_API}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': '2024-06-20',
    },
  };
  if (params && method === 'GET') {
    const qs = new URLSearchParams(flattenParams(params));
    url += `?${qs.toString()}`;
  } else if (params) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(flattenParams(params)).toString();
  }
  const res = await fetch(url, init);
  const raw = await res.text();
  let data: T & { error?: { message?: string; code?: string } };
  try {
    data = JSON.parse(raw);
  } catch {
    const err = new Error(`Stripe returned a non-JSON response (${res.status}): ${raw.slice(0, 120)}`) as StripeError;
    err.status = res.status || 502;
    err.isStripeError = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error?.message ?? `Stripe API error (${res.status})`) as StripeError;
    err.status = res.status;
    err.stripeCode = data.error?.code;
    err.isStripeError = true;
    throw err;
  }
  return data;
}

/** Verify a Stripe webhook signature (Stripe-Signature header, v1 scheme). */
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = new Map<string, string[]>();
  for (const item of sigHeader.split(',')) {
    const [k, v] = item.split('=', 2);
    if (!k || v === undefined) continue;
    const key = k.trim();
    parts.set(key, [...(parts.get(key) ?? []), v]);
  }
  const timestamp = parts.get('t')?.[0];
  const signatures = parts.get('v1') ?? [];
  if (!timestamp || signatures.length === 0) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
  const expectedHex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expectedBytes = encoder.encode(expectedHex);
  return signatures.some((sig) => timingSafeEqual(expectedBytes, encoder.encode(sig)));
}

/**
 * Ensure a reusable coupon exists (idempotent by id). Returns the coupon id.
 */
export async function ensureCoupon(env: Env, id: string, percentOff: number, name: string): Promise<string> {
  try {
    await stripeRequest(env, 'GET', `/v1/coupons/${id}`);
    return id;
  } catch (err) {
    if ((err as StripeError).status !== 404) throw err;
  }
  try {
    await stripeRequest(env, 'POST', '/v1/coupons', { id, percent_off: percentOff, duration: 'once', name });
  } catch (err) {
    if ((err as StripeError).stripeCode !== 'resource_already_exists') throw err;
  }
  return id;
}

/** Get or create the Stripe customer for a user, persisting the id in D1. */
export async function ensureStripeCustomer(env: Env, userId: string, email: string): Promise<string> {
  const row = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripeRequest<{ id: string }>(env, 'POST', '/v1/customers', {
    email,
    metadata: { user_id: userId },
  });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(customer.id, userId).run();
  return customer.id;
}
