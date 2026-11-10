// Public endpoint: count one read for "Most read" (sent by the site's own pages with navigator.sendBeacon).
// Stores a daily total per story only: no cookies, IP addresses or visitor ids are kept. The IP is used
// only by Cloudflare's rate limiter, in memory. Cross-site requests and unknown items are ignored.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { recordView } from '../../lib/server/site';
import { viewInputSchema } from '../../lib/shared/schemas';

const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, url, clientAddress, locals }) => {
  // Only this site's pages: browsers always send Origin on a beacon POST.
  if (request.headers.get('Origin') !== url.origin) return new Response(null, { status: 403 });
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') ?? '0') > 256) return new Response(null, { status: 413 });
  if (env.VIEW_LIMITER) {
    const { success } = await env.VIEW_LIMITER.limit({ key: `view:${clientAddress || 'unknown'}` });
    if (!success) return done(); // quietly drop: nothing to tell a reader
  }
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (raw.length > 256) return new Response(null, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const v = viewInputSchema.safeParse(parsed);
  if (!v.success) return new Response(null, { status: 422 });
  const job = recordView(v.data.item).catch(() => {}); // missing table (before migration 0009) or a blip: not worth a failure
  if (locals.cfContext) locals.cfContext.waitUntil(job);
  else await job;
  return done();
};

export const GET: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
