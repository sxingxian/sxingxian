import type { APIRoute } from 'astro';
import { adminListSeries, adminPageSeries, createSeries, type SeriesShowFilter } from '../../../../lib/server/series';
import { likePattern, readPaging } from '../../../../lib/shared/paging';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { seriesInputSchema } from '../../../../lib/shared/schemas';

const missing = (e: unknown) => (e as { code?: string })?.code === '42P01';
const NOT_READY = 'Series need the latest database update: run "Deploy Neon" in GitHub Actions.';

const SHOW = new Set<SeriesShowFilter>(['all', 'public', 'hidden']);

// No ?page → every series (the story editor's picker). ?page=&size=&show=&q= → one page of the Series screen.
export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  try {
    if (!p.has('page')) return json({ series: await adminListSeries() });
    const show = (p.get('show') ?? 'all') as SeriesShowFilter;
    if (!SHOW.has(show)) return error(400, 'Unknown filter');
    const q = (p.get('q') ?? '').trim().slice(0, 100);
    const { page, size, offset } = readPaging(p);
    return json({ ...(await adminPageSeries({ show, like: q ? likePattern(q) : null, size, offset })), page, size });
  } catch (e) {
    if (missing(e)) return json({ series: [], total: 0, counts: { all: 0, public: 0, hidden: 0 }, notReady: NOT_READY });
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
