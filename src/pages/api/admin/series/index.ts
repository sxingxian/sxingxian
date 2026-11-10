import type { APIRoute } from 'astro';
import { adminListSeries, createSeries } from '../../../../lib/server/series';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { seriesInputSchema } from '../../../../lib/shared/schemas';

const missing = (e: unknown) => (e as { code?: string })?.code === '42P01';
const NOT_READY = 'Series need the latest database update: run "Deploy Neon" in GitHub Actions.';

export const GET: APIRoute = async () => {
  try {
    return json({ series: await adminListSeries() });
  } catch (e) {
    if (missing(e)) return json({ series: [], notReady: NOT_READY });
    throw e;
  }
};

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, seriesInputSchema, 5000);
  if (!body.ok) return body.res;
  try {
    return json({ series: await createSeries(body.data) }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'That address is already used by another series');
    if (missing(e)) return error(503, NOT_READY);
    throw e;
  }
};
