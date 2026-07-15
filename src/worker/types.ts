/** Cloudflare Email Service send binding (structured send API). */
export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailSendBinding {
  send(message: {
    from: string | EmailAddress;
    to: string | EmailAddress | (string | EmailAddress)[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | EmailAddress;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string }>;
}

export interface Env {
  DB: D1Database;
  PRODUCT_IMAGES: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  EMAIL?: EmailSendBinding;
  ADMIN_EMAILS?: string;
  EMAIL_FROM?: string;
  CANONICAL_HOST?: string;
  BUSINESS_ADDRESS?: string;
  GA4_MEASUREMENT_ID?: string;
  GA4_API_SECRET?: string;
  GSC_VERIFICATION?: string; // google-site-verification meta tag token
  STRIPE_TAX_ENABLED?: string; // "1" once Stripe Tax is activated in the dashboard
  SENTRY_DSN?: string; // error monitoring; unset = disabled
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
  RESEND_API_KEY?: string;
  E2E_EXPOSE_TOKENS?: string; // '1' only in local/CI E2E — returns reset tokens in API responses
}

export const ROLES = ['customer', 'support', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  stripe_customer_id: string | null;
  is_admin: number;
  role: Role;
  name: string | null;
  created_at: string;
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  collection: string;
  description: string;
  ai_description: string | null;
  price: number;
  image_r2_key: string | null;
  is_active: number;
  is_bestseller: number;
  is_drop: number;
  drop_starts_at: string | null;
  drop_stock: number | null;
  ingredients: string | null;
  allergens: string | null;
  created_at: string;
}

export interface OrderRow {
  id: string;
  user_id: string | null;
  email: string | null;
  stripe_payment_intent: string | null;
  total: number;
  status: string;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_subscription_id: string | null;
  tier: string;
  status: string;
  cadence: string;
  items_json: string | null;
  next_billing_date: string | null;
  cancel_at_period_end: number;
  created_at: string;
}

export interface FlavorProfileRow {
  user_id: string;
  answers_json: string;
  condition: string | null;
  diagnosis: string | null;
  prescribed_json: string | null;
  updated_at: string;
}

export const TIERS = {
  starter: { name: 'Starter Rx', items: 4, price: 3900 },
  standard: { name: 'Standard Rx', items: 6, price: 5400 },
  full: { name: 'Full Prescription', items: 8, price: 6900 },
} as const;

export type TierKey = keyof typeof TIERS;

export const CADENCES = {
  monthly: { label: 'Monthly', intervalCount: 1, priceMultiplier: 1 },
  bimonthly: { label: 'Every 2 months', intervalCount: 2, priceMultiplier: 1 },
  // Annual prepay: 12 boxes billed once a year at 10× the box price (2 months free).
  annual: { label: 'Annual', intervalCount: 12, priceMultiplier: 10 },
} as const;

export type CadenceKey = keyof typeof CADENCES;

/** Subscription statuses that count as "has a live box". */
export const LIVE_SUB_STATUSES = ['active', 'past_due', 'paused'];

export const LOYALTY_TIERS = [
  { key: 'patient', name: 'Patient', min: 0 },
  { key: 'resident', name: 'Resident', min: 150 },
  { key: 'attending', name: 'Attending', min: 400 },
  { key: 'chief', name: 'Chief of Medicine', min: 1000 },
] as const;

export const COLLECTIONS = ['mayo', 'butter', 'burger-sauce', 'toppers', 'seasoning'] as const;

// Pricing plays (cents)
export const FREE_SHIPPING_THRESHOLD = 4500;
export const SHIPPING_FEE = 695;
export const BUNDLE_MIN_QTY = 3;
export const BUNDLE_COUPON = { id: 'FD_ANY3_15', percentOff: 15, name: 'Any 3+ items — 15% off' };
export const FIRST_BOX_COUPON = { id: 'FD_FIRST_BOX_20', percentOff: 20, name: 'First Rx Box — 20% off' };
export const DROP_EARLY_ACCESS_MS = 48 * 3600 * 1000;
// Board Certification redemption: points are worth 1¢ each, spent in
// 500-point blocks ($5). Earn rate is 1 pt/$1 → ~1% payback.
export const POINT_VALUE_CENTS = 1;
export const REDEEM_BLOCK = 500;
// Both sides of a referral earn this when the referred friend's first order is paid.
export const REFERRAL_POINTS = 500;

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  role: Role;
}

export interface RequestContext {
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  user: AuthUser | null;
}
