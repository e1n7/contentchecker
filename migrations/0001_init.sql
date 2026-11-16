CREATE TABLE IF NOT EXISTS ban_words (
  id INTEGER PRIMARY KEY NOT NULL,
  country_code TEXT NOT NULL CHECK (country_code IN ('PH', 'US', 'BR', 'RO')),
  word TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ban_words_country_enabled_id_idx
  ON ban_words (country_code, enabled, id);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  window_started TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_updated_at_idx
  ON rate_limit_buckets (updated_at);

CREATE TABLE IF NOT EXISTS analyze_content_slots (
  slot_id TEXT PRIMARY KEY NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analyze_content_slots_expires_at_idx
  ON analyze_content_slots (expires_at);
