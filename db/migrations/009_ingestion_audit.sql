-- Historical rows have NULL cross-checks: they were not compared.
ALTER TABLE bot_hits
  ADD COLUMN collector_bot_name TEXT,
  ADD COLUMN collector_bot_category TEXT,
  ADD COLUMN classification_source TEXT CHECK (classification_source IN ('sender', 'collector')),
  ADD COLUMN classification_mismatch BOOLEAN;

-- Compact, exact delivery counts, not sampling-weighted traffic estimates.
-- First/last receipt timestamps plus the latest keyed UA fingerprint avoid retaining
-- refused request bodies or raw UAs. At most six rows per project per day,
-- regardless of UA/name churn. The existing retention job prunes by day.
CREATE TABLE bot_rejections (
  day DATE NOT NULL,
  project_name TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('not_bot', 'non_production', 'project_quota_exceeded', 'invalid_payload', 'invalid_event_id', 'duplicate')),
  ua_fingerprint TEXT NOT NULL,
  bot_name TEXT NOT NULL,
  bot_category TEXT NOT NULL,
  count BIGINT NOT NULL DEFAULT 1 CHECK (count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day, project_name, reason)
);
