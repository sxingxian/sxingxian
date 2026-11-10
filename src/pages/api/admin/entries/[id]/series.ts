// A story's series and part number. Saved straight away from the editor's publishing panel.
import type { APIRoute } from 'astro';
import { getEntrySeries, PartTakenError, setEntrySeries } from '../../../../../lib/server/series';
import { error, json, readBody } from '../../../../../lib/server/http';
import { entrySeriesSchema } from '../../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../../lib/shared/safe';

const missing = (e: unknown) => (e as { code?: string })?.code === '42P01';

export const GET: APIRoute = async ({ params }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  try {
    return json(await getEntrySeries(params.id!));
  } catch (e) {
    if (missing(e)) return json({ seriesId: null, part: null });
    throw e;
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const body = await readBody(request, entrySeriesSchema, 1000);
  if (!body.ok) return body.res;
  try {
    return json(await setEntrySeries(params.id!, body.data.seriesId, body.data.part));
  } catch (e) {
    if (e instanceof PartTakenError) return error(409, e.message);
    if (missing(e)) return error(503, 'Series need the latest database update: run "Deploy Neon" in GitHub Actions.');
    if (e instanceof Error && e.message === 'Not found') return error(404, 'That series no longer exists, or this entry isn’t a story');
    throw e;
  }
};
