// Stories moved from /journal to /story (9 Nov 2026). Old links get a permanent redirect; the query
// (e.g. ?topic=) is kept. The target is always same-origin and built from a fixed path.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ url }) =>
  new Response(null, { status: 301, headers: { Location: `/story${url.search}`, 'Cache-Control': 'public, max-age=86400' } });
export const HEAD = GET;
