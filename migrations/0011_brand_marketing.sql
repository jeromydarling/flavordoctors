-- Brand Studio: brand identity as data (key-value; JSON values where structured).
CREATE TABLE brand_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Permanent marketing suppression list. Survives contact deletion and
-- re-signup; checked at queue time AND send time. Rows are never deleted by
-- product code — removal is a deliberate manual operation.
CREATE TABLE mkt_suppression (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'unsubscribe', -- unsubscribe | bounce | complaint | manual
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
