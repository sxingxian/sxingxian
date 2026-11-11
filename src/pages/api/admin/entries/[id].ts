// One entry. The editor autosaves content here:
//  - Draft or Scheduled: straight into the entry (nobody sees it yet).
//  - Published (live): into entry_edits, kept private until Update. Visitors keep seeing the live version.
// Draft / Scheduled / Published changes go through ./[id]/state.
import type { APIRoute } from 'astro';
import { adminGetEntry, contentFields, deleteEntry, deleteEntryEdits, getEntryEdits, putEntryEdits, slugTaken, updateEntryContent } from '../../../../lib/server/repo';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { entryContentSchema } from '../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../lib/shared/safe';
import { entryState } from '../../../../lib/shared/state';
import type { Entry, EntryEdits } from '../../../../lib/shared/types';

// Key order doesn't matter (jsonb reorders keys), so compare a sorted copy.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
}
const FIELDS = ['title', 'slug', 'dek', 'topics', 'body', 'cover_media_id', 'video_url', 'meta'] as const;
function sameAsLive(e: Entry, c: EntryEdits): boolean {
  return FIELDS.every((k) => JSON.stringify(canon(e[k] ?? null)) === JSON.stringify(canon(c[k] ?? null)));
}

export const GET: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const entry = await adminGetEntry(params.id!);
  if (!entry) return error(404, 'Not found');
  return json({ entry, edits: entryState(entry) === 'published' ? await getEntryEdits(entry.id) : null });
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const body = await readBody(request, entryContentSchema);
  if (!body.ok) return body.res;
  const cur = await adminGetEntry(params.id!);
  if (!cur) return error(404, 'Not found');
  const c = contentFields(body.data);
  try {
    if (entryState(cur) === 'published') {
      if (await slugTaken(cur.kind, c.slug, cur.id)) return error(409, 'That slug is already used');
      // Edited back to what's live: nothing to keep.
      if (sameAsLive(cur, c)) {
        await deleteEntryEdits(cur.id);
        return json({ entry: cur, edits: null });
      }
      if (await putEntryEdits(cur.id, c)) return json({ entry: cur, edits: c });
      // entry_edits isn't there yet (the migration runs after the code goes live): save as before.
    }
    const entry = await updateEntryContent(cur.id, c);
    return entry ? json({ entry, edits: null }) : error(404, 'Not found');
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'That slug is already used');
    throw e;
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  await deleteEntry(params.id!);
  return json({ ok: true });
};
