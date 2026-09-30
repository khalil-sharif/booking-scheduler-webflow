-- booking-scheduler-webflow: local persistence schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS installations (
  site_id        TEXT PRIMARY KEY,
  access_token   TEXT NOT NULL,
  scopes         TEXT NOT NULL,
  timezone       TEXT NOT NULL DEFAULT 'UTC',   -- site's configured timezone (IANA)
  public_key     TEXT NOT NULL,                 -- embedded in the widget snippet to scope public API calls
  services_collection_id TEXT,
  bookings_collection_id TEXT,
  installed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id               TEXT PRIMARY KEY,
  site_id          TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price            REAL NOT NULL DEFAULT 0,
  description      TEXT NOT NULL DEFAULT '',
  cms_item_id      TEXT,
  active           INTEGER NOT NULL DEFAULT 1
);

-- Weekly recurring availability: day_of_week 0 (Sun) .. 6 (Sat), times as HH:MM in site timezone.
CREATE TABLE IF NOT EXISTS availability_rules (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blackout_dates (
  id      TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  date    TEXT NOT NULL,                       -- YYYY-MM-DD in site timezone
  reason  TEXT,
  UNIQUE(site_id, date)
);

CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL REFERENCES installations(site_id) ON DELETE CASCADE,
  service_id     TEXT NOT NULL REFERENCES services(id),
  customer_name  TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  start_utc      TEXT NOT NULL,                -- ISO 8601 UTC
  end_utc        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
  manage_token   TEXT NOT NULL UNIQUE,         -- signed token for reschedule/cancel links
  cms_item_id    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_services_site ON services(site_id);
CREATE INDEX IF NOT EXISTS idx_rules_site ON availability_rules(site_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_bookings_site_start ON bookings(site_id, start_utc);
