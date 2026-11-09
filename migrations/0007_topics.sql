-- Multiple topics per entry, and topic lists for Work, Photos and Film (9 Nov 2026).
-- Expand step only: `topic` stays and the code keeps it equal to topics[1], so the previous
-- release keeps working and rolling back is safe. A later migration can drop `topic`.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}';

-- Existing entries keep their topic as the first (and only) one.
UPDATE entries SET topics = ARRAY[topic] WHERE topic <> '' AND cardinality(topics) = 0;

-- Filtering by topic ("$1 = ANY(topics)") on the public lists.
CREATE INDEX IF NOT EXISTS entries_topics_idx ON entries USING gin (topics);

-- Seed the Work / Photos / Film lists from topics already typed on those entries (up to 12 each,
-- most used first), so nothing disappears from the editors. Left alone if the owner already saved it.
INSERT INTO settings (key, value)
SELECT 'topics', jsonb_build_object(
  'work',   COALESCE((SELECT jsonb_agg(t) FROM (SELECT left(topic, 30) AS t FROM entries WHERE kind = 'project' AND topic <> '' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 12) s), '[]'::jsonb),
  'photos', COALESCE((SELECT jsonb_agg(t) FROM (SELECT left(topic, 30) AS t FROM entries WHERE kind = 'gallery' AND topic <> '' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 12) s), '[]'::jsonb),
  'film',   COALESCE((SELECT jsonb_agg(t) FROM (SELECT left(topic, 30) AS t FROM entries WHERE kind = 'film'    AND topic <> '' GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 12) s), '[]'::jsonb)
)
ON CONFLICT (key) DO NOTHING;
