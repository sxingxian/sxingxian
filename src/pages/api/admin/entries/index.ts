import type { APIRoute } from 'astro';
import { adminListEntries, createEntry } from '../../../../lib/server/repo';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { entryContentSchema } from '../../../../lib/shared/schemas';
import type { EntryKind } from '../../../../lib/shared/types';

const KINDS = new Set(['post', 'project', 'gallery', 'film']);

export const GET: APIRoute = async ({ url }) => {
  const kind = url.searchParams.get('kind');
  if (kind && !KINDS.has(kind)) return error(400, 'Unknown kind');
  return json({ entries: await adminListEntries((kind as EntryKind) ?? undefined) });
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
