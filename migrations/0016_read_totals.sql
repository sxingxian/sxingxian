-- Read count on story pages (14 Nov 2026). Expand only: one new table, nothing existing changes.
-- item_views keeps about 400 days of daily totals (Most read only needs 30). Before old days are
-- pruned, the daily job adds them here, so a story's read count keeps its older reads.
-- Aggregate counts only: no cookies, IP addresses or visitor ids are stored.
CREATE TABLE IF NOT EXISTS item_reads_total (
  item text   PRIMARY KEY CHECK (item ~ '^(n:[0-9a-f-]{36}|w:[0-9]{1,12})$'),
  n    bigint NOT NULL DEFAULT 0 CHECK (n >= 0)
);
