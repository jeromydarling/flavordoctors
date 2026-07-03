-- Migration 0007: growth wave — restock alerts, Treatment Plans (recipes),
-- NPS pulse, cancel-flow save offers, cancel-at-period-end tracking.

CREATE TABLE IF NOT EXISTS restock_alerts (
  email TEXT NOT NULL,
  product_id TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, product_id)
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products (id),
  intro TEXT NOT NULL,      -- one-paragraph hook, also the meta description
  body_html TEXT NOT NULL,  -- sanitized article body
  is_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recipes_product ON recipes (product_id);

CREATE TABLE IF NOT EXISTS nps_responses (
  order_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS save_offer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL, -- viewed | skip | pause | discount | cancel | undo_cancel
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
