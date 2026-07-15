-- The product-event spine: the trigger rail for auto-drafted marketing
-- content (and later lifecycle automations). dedupe_key makes every event
-- idempotent — one kit per product-publish, not one per edit.
CREATE TABLE mkt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, -- product_published | drop_live | back_in_stock | low_stock
  subject_id TEXT NOT NULL, -- product id
  dedupe_key TEXT NOT NULL UNIQUE,
  payload TEXT, -- JSON snapshot of the facts at event time
  status TEXT NOT NULL DEFAULT 'pending', -- pending | drafted | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE INDEX idx_mkt_events_status ON mkt_events (status);

-- Auto-drafted marketing kits. Always editable drafts — nothing auto-posts.
CREATE TABLE mkt_drafts (
  id TEXT PRIMARY KEY,
  event_id INTEGER,
  product_id TEXT,
  kind TEXT NOT NULL, -- launch_kit | back_in_stock | low_stock
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- JSON {instagram, tweet, email_md, blurb}
  status TEXT NOT NULL DEFAULT 'new', -- new | edited | used | archived
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_mkt_drafts_status ON mkt_drafts (status);

-- Thin AI usage ledger: every model call logs one row so spend is inspectable.
CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL, -- workers-ai | elevenlabs | higgsfield
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
