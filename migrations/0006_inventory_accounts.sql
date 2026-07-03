-- Migration 0006: inventory (co-packer lots, FEFO, movement ledger, reorder
-- points) + customer account management (password resets, preferred name).

CREATE TABLE IF NOT EXISTS inventory_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products (id),
  lot_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,  -- received units
  remaining INTEGER NOT NULL, -- decremented FEFO as orders ship
  best_by TEXT,               -- ISO date from the co-packer label
  po_ref TEXT,
  note TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lots_fefo ON inventory_lots (product_id, best_by, id);

-- Single source of truth for on-hand: SUM(delta) per product.
CREATE TABLE IF NOT EXISTS inventory_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  lot_id INTEGER,       -- NULL for unallocated (oversold) or manual +adjust
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,   -- receive | order | subscription | adjust
  ref TEXT,             -- order id / invoice id / lot code / reason
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON inventory_moves (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moves_ref ON inventory_moves (kind, ref);

ALTER TABLE products ADD COLUMN reorder_point INTEGER NOT NULL DEFAULT 24;

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY, -- sha256 of the emailed token
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resets_email ON password_resets (email);

ALTER TABLE users ADD COLUMN name TEXT;
