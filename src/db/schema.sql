-- Unsay register schema.
-- "Gesagt ist gebucht": every firm commitment becomes a row here, anchored to
-- the exact words that were spoken (start_ms/end_ms into the call recording).

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  item TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_day TEXT NOT NULL,
  delivery_window TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS free_slots (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  window TEXT NOT NULL,
  taken INTEGER NOT NULL DEFAULT 0
);

-- One row per phone call (inbound order-desk calls, outbound callback calls).
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  purpose TEXT NOT NULL CHECK (purpose IN ('order_desk', 'callback', 'browser_fallback')),
  order_id TEXT REFERENCES orders(order_id),
  triggered_by_entry_id TEXT,
  twilio_call_sid TEXT,
  from_number TEXT,
  to_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'no_answer', 'failed')),
  recording_url TEXT,
  recording_path TEXT,
  transcript_words TEXT, -- JSON array: [{ text, start_ms, end_ms, speaker }]
  speech_model_used TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT
);

-- Every extracted, word-anchored commitment. This is the register the UI reads.
CREATE TABLE IF NOT EXISTS register_entries (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES calls(id),
  order_id TEXT REFERENCES orders(order_id),
  field TEXT NOT NULL, -- delivery_day | delivery_window | price | callback
  value TEXT NOT NULL,
  quote TEXT NOT NULL,
  speaker_role TEXT NOT NULL CHECK (speaker_role IN ('agent', 'customer')),
  commitment_level TEXT NOT NULL CHECK (commitment_level IN ('firm', 'tentative')),
  start_ms INTEGER,
  end_ms INTEGER,
  anchor_status TEXT NOT NULL DEFAULT 'ok' CHECK (anchor_status IN ('ok', 'missing')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'broken', 'confirmed', 'superseded', 'needs_human')),
  broken_at TEXT,
  supersedes_id TEXT REFERENCES register_entries(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_register_order_field ON register_entries(order_id, field);
CREATE INDEX IF NOT EXISTS idx_register_status ON register_entries(status);

-- Idempotency guard for the observer: exactly one outbound call per (entry, new_value).
CREATE TABLE IF NOT EXISTS callback_attempts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES register_entries(id),
  new_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  call_id TEXT REFERENCES calls(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (entry_id, new_value)
);
