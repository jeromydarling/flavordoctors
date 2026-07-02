export interface Env {
  DB: D1Database;
  PRODUCT_IMAGES: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  ADMIN_EMAILS?: string;
  EMAIL_FROM?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
  RESEND_API_KEY?: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  stripe_customer_id: string | null;
  is_admin: number;
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
  items_json: string | null;
  next_billing_date: string | null;
  created_at: string;
}

export const TIERS = {
  starter: { name: 'Starter Rx', items: 4, price: 3900 },
  standard: { name: 'Standard Rx', items: 6, price: 5400 },
  full: { name: 'Full Prescription', items: 8, price: 6900 },
} as const;

export type TierKey = keyof typeof TIERS;

export const COLLECTIONS = ['mayo', 'butter', 'burger-sauce', 'toppers', 'seasoning'] as const;

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

export interface RequestContext {
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  user: AuthUser | null;
}
