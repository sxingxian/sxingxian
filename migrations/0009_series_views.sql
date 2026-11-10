-- Series and "Most read" (11 Nov 2026). Expand only: new tables, nothing existing changes,
-- so the previous release keeps working and rolling back is safe.

-- A series groups stories into numbered parts.
CREATE TABLE IF NOT EXISTS series (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  planned_parts integer CHECK (planned_parts IS NULL OR planned_parts BETWEEN 1 AND 99),
  is_public     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Which series a story belongs to, and its part number. Kept apart from `entries`, so reading
-- and saving stories never depends on this migration having run.
-- Deleting a series or a story removes the link only.
CREATE TABLE IF NOT EXISTS series_parts (
  entry_id  uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  part      integer NOT NULL CHECK (part BETWEEN 1 AND 99),
  UNIQUE (series_id, part)
);
CREATE INDEX IF NOT EXISTS series_parts_series_idx ON series_parts (series_id, part);

-- Reads per day. Aggregate counts only: no cookies, IP addresses or visitor ids are stored.
-- item = 'n:<entry uuid>' for a story here, 'w:<WordPress post id>' for a click through to WordPress.
CREATE TABLE IF NOT EXISTS item_views (
  item text    NOT NULL CHECK (item ~ '^(n:[0-9a-f-]{36}|w:[0-9]{1,12})$'),
  day  date    NOT NULL,
  n    integer NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (item, day)
);
CREATE INDEX IF NOT EXISTS item_views_day_idx ON item_views (day);
