-- Migration 0008: The House Call Network — affiliate program + self-updating
-- resource library.

CREATE TABLE IF NOT EXISTS affiliates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users (id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT,                 -- primary social handle / site
  links TEXT,                  -- JSON array of URLs
  audience TEXT,               -- who follows them
  pitch TEXT,                  -- how they'd promote us
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | paused | banned
  ai_score INTEGER,
  ai_reasoning TEXT,
  ref_code TEXT UNIQUE,        -- link token (?aff=...)
  code TEXT UNIQUE,            -- vanity Stripe promo code
  code_synced INTEGER NOT NULL DEFAULT 0, -- promo code exists in Stripe
  tier TEXT NOT NULL DEFAULT 'resident',  -- resident | attending | chief
  payout_method TEXT NOT NULL DEFAULT 'credit', -- credit (points x1.25) | connect (cash)
  stripe_account_id TEXT,
  probation INTEGER NOT NULL DEFAULT 1,   -- longer holds + capped first payout
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates (status, created_at);

-- Money ledger: positive = earned, negative = clawback/payout. Idempotent per
-- (kind, ref) like the points ledger.
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id TEXT NOT NULL REFERENCES affiliates (id),
  order_id TEXT,
  kind TEXT NOT NULL,          -- first_order | recurring | clawback | payout
  amount INTEGER NOT NULL,     -- cents
  status TEXT NOT NULL DEFAULT 'pending', -- pending | cleared | paid | void
  clears_at TEXT,              -- refund window end
  ref TEXT,                    -- payment/invoice ref for idempotency
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aff_comm_dedupe ON affiliate_commissions (kind, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aff_comm_affiliate ON affiliate_commissions (affiliate_id, status);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aff_clicks ON affiliate_clicks (affiliate_id, created_at);

-- Self-maintaining library: cached AI enrichments keyed by a hash of their
-- source data — the nightly cron regenerates whatever went stale.
CREATE TABLE IF NOT EXISTS library_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- product_kit | promo_kit
  ref TEXT NOT NULL,           -- product id / promotion id
  source_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, ref)
);

ALTER TABLE orders ADD COLUMN affiliate_id TEXT;
ALTER TABLE subscriptions ADD COLUMN affiliate_id TEXT;
