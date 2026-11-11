// POST /api/admin/entries/:id/state: the publishing actions.
//   publish     Draft or Scheduled → live now.
//   schedule    Draft or Scheduled → goes live by itself at `at` (future).
//   unpublish   Scheduled or Published → Draft (private edits are kept, applied to the draft).
//   update      Published: apply the private edits to the live entry.
//   discard     Published: drop the private edits.
//   redate      Published: change the date shown on it (`at`, not in the future).
import type { APIRoute } from 'astro';
import { adminGetEntry, applyEntryEdits, deleteEntryEdits, getEntryEdits, setEntryDate, setEntryState } from '../../../../../lib/server/repo';
import { error, isUniqueViolation, json, readBody } from '../../../../../lib/server/http';
import { entryStateSchema } from '../../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../../lib/shared/safe';
import { entryState } from '../../../../../lib/shared/state';

const SLACK_MS = 30_000; // a schedule must be at least this far ahead

export const POST: APIRoute = async ({ params, request }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const body = await readBody(request, entryStateSchema, 1000);
  if (!body.ok) return body.res;
  const cur = await adminGetEntry(params.id!);
  if (!cur) return error(404, 'Not found');
  const state = entryState(cur);
  const { action, at } = body.data;
  const when = at ? new Date(at).getTime() : NaN;

  try {
    switch (action) {
      case 'publish':
        if (state === 'published') return error(409, 'It’s already live');
        await applyEntryEdits(cur.id);
        await setEntryState(cur.id, 'published', new Date().toISOString());
        break;
      case 'schedule':
        if (state === 'published') return error(409, 'It’s live. Unpublish it first to schedule it');
        if (!at || !(when > Date.now() + SLACK_MS)) return error(400, 'Pick a time in the future');
        await applyEntryEdits(cur.id);
        await setEntryState(cur.id, 'published', new Date(when).toISOString());
        break;
      case 'unpublish':
        if (state === 'draft') return error(409, 'It’s already a draft');
        await applyEntryEdits(cur.id);
        await setEntryState(cur.id, 'draft', cur.published_at);
        break;
      case 'update':
        if (state !== 'published') return error(409, 'Only a live entry has edits to apply');
        await applyEntryEdits(cur.id);
        break;
      case 'discard':
        await deleteEntryEdits(cur.id);
        break;
      case 'redate':
        if (state !== 'published') return error(409, 'Only a live entry has a shown date');
        if (!at || Number.isNaN(when)) return error(400, 'Pick a date');
        if (when > Date.now()) return error(400, 'A future date would schedule it. Unpublish it first, then schedule it');
        await setEntryDate(cur.id, new Date(when).toISOString());
        break;
    }
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'That slug is already used by another entry. Change it, then try again');
    throw e;
  }

  const entry = await adminGetEntry(cur.id);
  if (!entry) return error(404, 'Not found');
  return json({ entry, edits: entryState(entry) === 'published' ? await getEntryEdits(entry.id) : null });
};
