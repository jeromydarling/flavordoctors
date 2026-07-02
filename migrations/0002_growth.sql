-- Migration 0002: growth features — cadence, quiz profiles, ratings,
-- loyalty points, limited drops ("Clinical Trials"), email dedupe.

ALTER TABLE subscriptions ADD COLUMN cadence TEXT NOT NULL DEFAULT 'monthly'; -- monthly | bimonthly

ALTER TABLE products ADD COLUMN is_drop INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN drop_starts_at TEXT; -- ISO timestamp; subscribers get 48h early access
ALTER TABLE products ADD COLUMN drop_stock INTEGER;  -- remaining units; NULL = unlimited

-- Intake Exam (flavor diagnosis quiz) results
CREATE TABLE IF NOT EXISTS flavor_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  answers_json TEXT NOT NULL,
  condition TEXT,        -- e.g. "Acute Blandness, Stage 2"
  diagnosis TEXT,        -- AI-written doctor's note
  prescribed_json TEXT,  -- JSON array of recommended product ids
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Flavor Health Record: 1-click "how did the treatment work?" ratings
CREATE TABLE IF NOT EXISTS product_ratings (
  user_id TEXT NOT NULL REFERENCES users (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  rating INTEGER NOT NULL, -- 1..5
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, product_id)
);

-- Board Certification loyalty: points ledger (1 pt per $ spent)
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL, -- order | invoice | bonus
  ref TEXT,             -- source id for idempotency
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_dedupe ON points_ledger (reason, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_points_user ON points_ledger (user_id);

-- Clinical Trials waitlist
CREATE TABLE IF NOT EXISTS drop_waitlist (
  email TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products (id),
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, product_id)
);

-- Transactional-email dedupe (refill reminders, win-backs, drop notifications)
CREATE TABLE IF NOT EXISTS sent_emails (
  email TEXT NOT NULL,
  kind TEXT NOT NULL, -- refill | winback | drop
  ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, kind, ref)
);
