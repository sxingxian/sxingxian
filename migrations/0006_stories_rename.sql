-- The Journal section is now "Stories" at /story (9 Nov 2026).
-- Only values still at the old defaults change; anything the owner customised is left alone.
UPDATE settings SET value = jsonb_set(value, '{tagline}', '"stories"')
 WHERE key = 'site' AND value->>'tagline' = 'journal';
-- Footer links that point exactly at /journal now point at /story (the old path also redirects).
UPDATE settings SET value = replace(value::text, '"/journal"', '"/story"')::jsonb
 WHERE key = 'footer' AND value::text LIKE '%"/journal"%';
