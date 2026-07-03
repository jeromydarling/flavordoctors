-- Migration 0004: Customer OS — admin notes, support tickets, message threads.

CREATE TABLE IF NOT EXISTS customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  author TEXT NOT NULL, -- admin email
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_email ON customer_notes (email);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  source TEXT NOT NULL DEFAULT 'bot', -- bot | form
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets (email);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets (id),
  role TEXT NOT NULL, -- customer | agent | bot
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages (ticket_id);
