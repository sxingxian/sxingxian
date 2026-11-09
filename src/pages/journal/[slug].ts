// /journal/<slug> → /story/<slug> (permanent). The slug is re-encoded, so the target stays a same-origin path.
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ params, url }) => {
  const slug = encodeURIComponent(params.slug ?? '');
  return new Response(null, { status: 301, headers: { Location: `/story/${slug}${url.search}`, 'Cache-Control': 'public, max-age=86400' } });
};
export const HEAD = GET;
