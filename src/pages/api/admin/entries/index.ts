import type { APIRoute } from 'astro';
import { adminListEntries, adminPageEntries, createEntry, type EntryStateFilter } from '../../../../lib/server/repo';
import { likePattern, readPaging } from '../../../../lib/shared/paging';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { entryContentSchema } from '../../../../lib/shared/schemas';
import type { EntryKind } from '../../../../lib/shared/types';

const KINDS = new Set(['post', 'project', 'gallery', 'film']);
const STATES = new Set<EntryStateFilter>(['all', 'draft', 'scheduled', 'published']);

// ?kind=post → every entry (pickers). ?kind=post&page=2&size=10&state=draft&q=… → one page of the admin list.
export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  const kind = p.get('kind');
  if (kind && !KINDS.has(kind)) return error(400, 'Unknown kind');
  if (!p.has('page')) return json({ entries: await adminListEntries((kind as EntryKind) ?? undefined) });
  if (!kind) return error(400, 'Choose a kind');
  const state = (p.get('state') ?? 'all') as EntryStateFilter;
  if (!STATES.has(state)) return error(400, 'Unknown state');
  const q = (p.get('q') ?? '').trim().slice(0, 100);
  const { page, size, offset } = readPaging(p);
  const result = await adminPageEntries({ kind: kind as EntryKind, state, like: q ? likePattern(q) : null, size, offset });
  return json({ ...result, page, size });
};

// A new entry is always a draft; publishing is a separate step (POST /api/admin/entries/:id/state).
export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, entryContentSchema);
  if (!body.ok) return body.res;
  try {
    return json({ entry: await createEntry(body.data), edits: null }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'That slug is already used');
    throw e;
  }
};
