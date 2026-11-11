-- Publishing states (11 Nov 2026): Draft · Scheduled · Published, and private edits to live entries.
-- Expand only: one new table, and a data tidy-up the previous release reads the same way, so it keeps
-- working and rolling back is safe.

-- Edits to a live entry, kept here until "Update" applies them (or "Discard" drops them). Visitors keep
-- seeing the entry's own columns. Kept apart from `entries`, so reading and saving entries never depends
-- on this migration having run. Deleting an entry removes its edits.
CREATE TABLE IF NOT EXISTS entry_edits (
  entry_id   uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  data       jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- "Published but hidden" was the same as a draft for visitors. With one state, it is a draft.
UPDATE entries SET status = 'draft', updated_at = now() WHERE status = 'published' AND is_public = false;
