-- Migration 0001: initial schema for Flavor Doctors

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  stripe_customer_id TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  collection TEXT NOT NULL, -- mayo | butter | burger-sauce | toppers | seasoning
  description TEXT NOT NULL,
  ai_description TEXT,
  price INTEGER NOT NULL, -- cents (USD)
  image_r2_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_bestseller INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_collection ON products (collection);
CREATE INDEX IF NOT EXISTS idx_products_active ON products (is_active);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id),
  email TEXT,
  stripe_payment_intent TEXT,
  total INTEGER NOT NULL, -- cents
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | shipped | delivered | canceled | refunded
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  quantity INTEGER NOT NULL,
  price_at_purchase INTEGER NOT NULL -- cents
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  stripe_subscription_id TEXT UNIQUE,
  tier TEXT NOT NULL, -- starter | standard | full
  status TEXT NOT NULL DEFAULT 'active', -- active | past_due | canceled | incomplete
  items_json TEXT, -- JSON array of product ids in the monthly box
  next_billing_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
