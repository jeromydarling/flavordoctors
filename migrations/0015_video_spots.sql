-- AI-generated video spots: one row per spot through its whole lifecycle.
-- drafting → submitted → generating → importing → ready | failed
CREATE TABLE mkt_spots (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  brief TEXT NOT NULL,
  motion_prompt TEXT, -- editable; what the video model actually receives
  duration INTEGER NOT NULL DEFAULT 5, -- seconds
  status TEXT NOT NULL DEFAULT 'drafting',
  provider TEXT, -- e.g. kling-video/v2.5-turbo/pro/image-to-video
  request_id TEXT, -- Higgsfield queue id
  video_url TEXT, -- provider CDN url (transient)
  r2_key TEXT, -- cdn/spots/<id>.mp4 once imported
  voiceover_r2_key TEXT,
  music_r2_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX idx_mkt_spots_status ON mkt_spots (status);
