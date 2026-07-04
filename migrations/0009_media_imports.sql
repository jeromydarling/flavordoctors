-- Media import queue: the Worker (which has open egress) pulls remote files
-- into R2 on a short cron, so generated assets (e.g. Higgsfield renders) can
-- reach production without passing through a development sandbox.
CREATE TABLE media_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_media_imports_status ON media_imports (status);
