// Story topics (admin only).
//   GET  /api/admin/topics → { counts: { [topic]: number } } posts per topic
//   POST /api/admin/topics { changes: [{ from, to }] } → renames topics on posts (to = '' clears),
//        and in the WordPress category → topic mapping, so a rename doesn't orphan anything.
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { sql } from '../../../lib/server/db';
import { getSetting, putSetting } from '../../../lib/server/repo';
import { error, json, readBody } from '../../../lib/server/http';

const topic = z.string().trim().max(30);
const schema = z.object({ changes: z.array(z.object({ from: topic.min(1), to: topic })).max(24) });

export const GET: APIRoute = async () => {
  const rows = await sql()`SELECT topic, count(*)::int AS n FROM entries WHERE kind = 'post' AND topic <> '' GROUP BY topic`;
  return json({ counts: Object.fromEntries(rows.map((r) => [r.topic as string, r.n as number])) });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, schema, 8192);
  if (!body.ok) return body.res;
  let posts = 0;
  for (const { from, to } of body.data.changes) {
    if (from === to) continue;
    const r = await sql()`UPDATE entries SET topic = ${to}, updated_at = now() WHERE kind = 'post' AND topic = ${from} RETURNING 1`;
    posts += r.length;
  }
  const wp = await getSetting('wordpress');
  const map = { ...wp.categoryMap };
  let mapChanged = false;
  for (const [cat, t] of Object.entries(map)) {
    const change = body.data.changes.find((c) => c.from === t);
    if (!change) continue;
    mapChanged = true;
    if (change.to) map[cat] = change.to;
    else delete map[cat];
  }
  if (mapChanged) await putSetting('wordpress', { ...wp, categoryMap: map });
  return json({ ok: true, posts });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
