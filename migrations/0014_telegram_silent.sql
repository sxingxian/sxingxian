-- Telegram "send silently" per entry (13 Nov 2026). Expand only: one nullable column.
-- NULL = follow Settings → Telegram → Send silently; true / false = this entry's own choice.
-- Older code never reads or writes it; newer code works without it until this runs (it sends with sound).
ALTER TABLE entry_telegram ADD COLUMN IF NOT EXISTS silent boolean;
