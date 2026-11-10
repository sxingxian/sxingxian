// Topics across sections (admin only).
//   GET  /api/admin/topics → { counts: { post|project|gallery|film: { [topic]: number } } } entries per topic
//   POST /api/admin/topics { kind, changes: [{ from, to }] } → renames a topic on that kind's entries
//        (to = '' removes it). For stories, synced WordPress posts and the category → topic
//        mapping follow too, so a rename doesn't orphan anything.
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/server/db';
import { getSetting, putSetting } from '../../../lib/server/repo';
import { error, json, readBody } from '../../../lib/server/http';
import { MAX_TOPIC_LEN, type EntryKind } from '../../../lib/shared/types';
import { FALLBACK_TOPIC } from '../../../lib/server/wptopic';

const KINDS = ['post', 'project', 'gallery', 'film'] as const;
const topic = z.string().trim().max(MAX_TOPIC_LEN);
const schema = z.object({
  kind: z.enum(KINDS).default('post'),
  changes: z.array(z.object({ from: topic.min(1), to: topic })).max(24),
});

// Same fallback as the entry reads: a row written by the previous release may only have `topic`.
const CURRENT = `CASE WHEN cardinality(topics) = 0 AND topic <> '' THEN ARRAY[topic] ELSE topics END`;

export const GET: APIRoute = async () => {
  const rows = await sql().query(
    `SELECT kind, t AS topic, count(*)::int AS n
       FROM entries, unnest(${CURRENT}) AS t
      WHERE t <> ''
      GROUP BY kind, t`,
  );
  const counts = Object.fromEntries(KINDS.map((k) => [k, {} as Record<string, number>])) as Record<EntryKind, Record<string, number>>;
  for (const r of rows) {
    const k = r.kind as EntryKind;
    if (counts[k]) counts[k][r.topic as string] = r.n as number;
  }
  return json({ counts });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, schema, 8192);
  if (!body.ok) return body.res;
  const { kind, changes } = body.data;
  let updated = 0;
  for (const { from, to } of changes) {
    if (from === to) continue;
    // Replace (or drop, when to = '') the topic, keeping the owner's order and removing duplicates.
    const r = await sql().query(
      `UPDATE entries e
          SET topics = n.topics, topic = COALESCE(n.topics[1], ''), updated_at = now()
         FROM (
           SELECT id, ARRAY(
             SELECT t FROM unnest(array_replace(${CURRENT}, $2, $3)) WITH ORDINALITY AS u(t, i)
              WHERE t <> '' GROUP BY t ORDER BY min(i)
           ) AS topics
             FROM entries
            WHERE kind = $1 AND ($2 = ANY(topics) OR topic = $2)
         ) n
        WHERE e.id = n.id
      RETURNING 1`,
      [kind, from, to],
    );
    updated += r.length;
  }
  if (kind === 'post') {
    // WordPress posts carry a single topic: follow renames; a removed topic falls back to "Notes"
    // until the next sync or mapping save works it out again from the post's categories.
    for (const { from, to } of changes) {
      if (from === to) continue;
      await sql().query(`UPDATE external_posts SET topic = $2 WHERE topic = $1`, [from, to || FALLBACK_TOPIC]);
    }
    const wp = await getSetting('wordpress');
    const map = { ...wp.categoryMap };
    let mapChanged = false;
    for (const [cat, t] of Object.entries(map)) {
      const change = changes.find((c) => c.from === t);
      if (!change) continue;
      mapChanged = true;
      if (change.to) map[cat] = change.to;
      else delete map[cat];
    }
    if (mapChanged) await putSetting('wordpress', { ...wp, categoryMap: map });
  }
  return json({ ok: true, updated, posts: updated });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
