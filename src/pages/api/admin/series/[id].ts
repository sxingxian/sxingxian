import type { APIRoute } from 'astro';
import { deleteSeries, takenParts, updateSeries } from '../../../../lib/server/series';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { seriesInputSchema } from '../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../lib/shared/safe';

/** Parts already used in this series (for the editor's part number). */
export const GET: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  return json({ parts: await takenParts(params.id!) });
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const body = await readBody(request, seriesInputSchema, 5000);
  if (!body.ok) return body.res;
  try {
    const s = await updateSeries(params.id!, body.data);
    return s ? json({ series: s }) : error(404, 'Not found');
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'That address is already used by another series');
    throw e;
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  await deleteSeries(params.id!);
  return json({ ok: true });
};
