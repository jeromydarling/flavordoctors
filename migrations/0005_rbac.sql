-- Migration 0005: staff roles + audit trail.
-- Roles: customer (default) | support (customers, inbox, orders, analytics) | admin (everything).

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
UPDATE users SET role = 'admin' WHERE is_admin = 1;

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,   -- staff email
  action TEXT NOT NULL,  -- e.g. role_change, campaign_send, product_update
  target TEXT,           -- affected entity (email, product id, order id…)
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
