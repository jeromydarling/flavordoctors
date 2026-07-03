-- Migration 0003: Marketing OS — contacts/consent, campaigns + tracking,
-- lifecycle flows, landing pages, promotions, written reviews.

CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY,
  user_id TEXT,
  source TEXT NOT NULL DEFAULT 'unknown', -- waitlist | landing:{slug} | account | checkout
  marketing_consent INTEGER NOT NULL DEFAULT 1,
  unsub_token TEXT NOT NULL,
  ref_code TEXT,
  referred_by TEXT, -- ref_code of the referrer
  utm_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unsub ON contacts (unsub_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_ref ON contacts (ref_code);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  subject TEXT NOT NULL,
  subject_b TEXT, -- optional A/B variant
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | sent
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  email TEXT NOT NULL,
  variant TEXT, -- a | b
  kind TEXT NOT NULL, -- sent | open | click
  url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_campaign_events ON campaign_events (campaign_id, kind);

CREATE TABLE IF NOT EXISTS flows (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger TEXT NOT NULL, -- contact_created | order_created
  delay_days INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS landing_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  cta TEXT NOT NULL DEFAULT 'Get Early Access',
  offer TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  signups INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL, -- customer-facing Stripe promotion code
  percent_off INTEGER NOT NULL,
  banner_text TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id),
  product_id TEXT NOT NULL REFERENCES products (id),
  rating INTEGER NOT NULL,
  body TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, product_id)
);

-- Seed lifecycle flows (editable in admin). {{FIRST_NAME_OR_DOC}} etc. are
-- substituted at send time; links get tracking + unsubscribe automatically.
INSERT OR IGNORE INTO flows (key, name, enabled, trigger, delay_days, subject, body_html) VALUES
('prelaunch_welcome', 'Pre-launch #1 — Welcome', 1, 'contact_created', 0,
 'Your prescription is being prepared…',
 '<h2>Welcome to the waiting room 🩺</h2><p>You''re officially on the Flavor Doctors early-access list. We''re a small-batch flavor clinic: doctored mayos, shelf-stable ghee butters, drive-thru-grade burger sauces, dessert toppers, and fry seasonings — every one written up like the prescription it is.</p><p>Early-access patients get first dibs and launch pricing. Sit tight; the pharmacy is stocking shelves.</p>'),
('prelaunch_story', 'Pre-launch #2 — The Story', 1, 'contact_created', 3,
 'Why we started Flavor Doctors',
 '<h2>The diagnosis that started it all</h2><p>Most food isn''t sick — it''s just under-treated. We got tired of bland dinners and started compounding cures in a home kitchen: ranch dreams in mayo form, gochujang ghee for steaks, miso caramel for ice cream emergencies.</p><p>Every jar is small-batch, made with real ingredients, and labeled like the prescription it is. First, do no bland.</p>'),
('prelaunch_sneak_peek', 'Pre-launch #3 — Sneak Peek', 1, 'contact_created', 7,
 'First look: Meet Ranch Rx and Big Doc Sauce',
 '<h2>Patient files: two hero treatments 📋</h2><p><strong>Ranch Rx</strong> — cool buttermilk herbs meet rich, creamy mayo. Prescribed for sandwiches, fries, and 2am refrigerator visits.</p><p><strong>Big Doc Sauce</strong> — the classic burger prescription. A special sauce that makes homemade burgers taste like a guilty pleasure.</p><p>Thirty-two more treatments are waiting in the formulary. Early-access patients see them first.</p>'),
('prelaunch_behind_scenes', 'Pre-launch #4 — Behind the Scenes', 1, 'contact_created', 14,
 'Inside our test kitchen: the ghee butter reveal',
 '<h2>Why our butter line is ghee 🧈</h2><p>Regular compound butter needs a cold chain — ice packs, melted disappointment, sad Tuesdays. So we rebuilt the whole Doctored Butter line on clarified ghee: same flavor payload (miso-garlic, gochujang-sesame, black truffle), zero refrigeration until you crack the seal.</p><p>It ships like a pantry item and finishes a steak like a secret weapon.</p>'),
('review_request', 'Post-purchase — Review Request (day 3)', 1, 'order_created', 3,
 'What do you think, Doc?',
 '<h2>How did the treatment work? 🩺</h2><p>Your prescription arrived a few days ago — we''d love your read on it. Rate your items from your chart (it takes one click and sharpens your future prescriptions), and add a note if you''re feeling generous.</p><p><a href="{{SITE_URL}}/account" style="color:#27AE60;font-weight:bold;">Rate my treatments →</a></p>');
