-- The paced marketing outbox: queue AND permanent audit ledger in one table.
-- A frequent cron drains a few rows per tick — a deliberate pace ceiling for
-- domain warm-up and provider quotas. UNIQUE(broadcast_id, email) means an
-- address can never receive the same broadcast twice.
CREATE TABLE mkt_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id TEXT NOT NULL, -- campaign id (or sequence key later)
  variant TEXT NOT NULL DEFAULT 'a',
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sending | sent | failed | suppressed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  due_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (broadcast_id, email)
);
CREATE INDEX idx_mkt_sends_drain ON mkt_sends (status, due_at);

-- campaigns.status gains 'sending' while the outbox drains a campaign.
