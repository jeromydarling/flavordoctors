-- B2B relationship CRM: vendors, co-packers, distributors, retail buyers.
-- Distinct from end-customer support (tickets) and marketing contacts.
CREATE TABLE crm_contacts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE, -- lowercased
  name TEXT,
  company TEXT,
  kind TEXT NOT NULL DEFAULT 'vendor', -- vendor | distributor | retailer | other
  status TEXT NOT NULL DEFAULT 'lead', -- lead | active | key_account | at_risk | dormant
  tags TEXT, -- JSON array
  notes_md TEXT,
  city TEXT,
  region TEXT,
  last_touch_at TEXT,
  next_followup_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_crm_contacts_status ON crm_contacts (status);
CREATE INDEX idx_crm_contacts_kind ON crm_contacts (kind);

-- One timeline per contact: auto events and manual entries interleaved.
CREATE TABLE crm_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- call | meeting | email_out | email_in | note | order | shipment | price_change | system
  summary TEXT NOT NULL,
  detail TEXT,
  created_by TEXT, -- staff email; NULL = automatic
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_crm_interactions_contact ON crm_interactions (contact_id, created_at);

-- Small promises with due dates. The daily sweep auto-files follow-ups.
CREATE TABLE crm_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  auto_key TEXT UNIQUE, -- set for sweep-created tasks so each files at most once
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX idx_crm_tasks_due ON crm_tasks (done, due_at);
