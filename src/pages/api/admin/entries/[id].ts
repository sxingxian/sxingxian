import type { APIRoute } from 'astro';
import { z } from 'zod';
import { adminGetEntry, deleteEntry, setEntryVisibility, updateEntry } from '../../../../lib/server/repo';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { entryInputSchema } from '../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../lib/shared/safe';

const visibilitySchema = z.object({ is_public: z.boolean() });

export const GET: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const entry = await adminGetEntry(params.id!);
  return entry ? json({ entry }) : error(404, 'Not found');
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const body = await readBody(request, entryInputSchema);
  if (!body.ok) return body.res;
  try {
    const entry = await updateEntry(params.id!, body.data);
    return entry ? json({ entry }) : error(404, 'Not found');
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'That slug is already used');
    throw e;
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const body = await readBody(request, visibilitySchema, 1000);
  if (!body.ok) return body.res;
  await setEntryVisibility(params.id!, body.data.is_public);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  await deleteEntry(params.id!);
  return json({ ok: true });
};
