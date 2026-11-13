-- Remove invisible characters from titles (13 Nov 2026). Data only, no schema change.
-- Zero-width space (U+200B), word joiner (U+2060), byte-order mark (U+FEFF) and soft hyphen (U+00AD)
-- arrive with pasted text; they are invisible but break search, sorting and how titles look to crawlers.
-- New saves are cleaned by the server (stripInvisible), so this only fixes what is already stored.
-- Safe to re-run: rows without these characters are not touched.
UPDATE entries SET title = btrim(regexp_replace(title, '[\u200B\u2060\uFEFF\u00AD]', '', 'g')) WHERE title ~ '[\u200B\u2060\uFEFF\u00AD]';
UPDATE entry_edits SET data = jsonb_set(data, '{title}', to_jsonb(btrim(regexp_replace(data->>'title', '[\u200B\u2060\uFEFF\u00AD]', '', 'g')))) WHERE data->>'title' ~ '[\u200B\u2060\uFEFF\u00AD]';
UPDATE pages SET title = btrim(regexp_replace(title, '[\u200B\u2060\uFEFF\u00AD]', '', 'g')) WHERE title ~ '[\u200B\u2060\uFEFF\u00AD]';
UPDATE series SET title = btrim(regexp_replace(title, '[\u200B\u2060\uFEFF\u00AD]', '', 'g')) WHERE title ~ '[\u200B\u2060\uFEFF\u00AD]';
