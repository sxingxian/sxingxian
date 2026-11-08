// Serves uploaded media from whichever host it was stored on (R2, NAS, B2).
// Storage credentials stay on the server; the browser only ever sees /media/:id.
import type { APIRoute } from 'astro';
import { getMedia } from '../../lib/server/repo';
import { getObject } from '../../lib/server/storage';
import { UUID_RE } from '../../lib/shared/safe';

const SAFE_TYPES = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm))$/;

export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });
  const item = await getMedia(id);
  if (!item || !item.object_key || (item.provider !== 'r2' && item.provider !== 'nas' && item.provider !== 'b2')) {
    return new Response('Not found', { status: 404 });
  }
  const res = await getObject(item.provider, item.object_key, request);
  if (!res) return new Response('Not found', { status: 404 });

  const headers = new Headers(res.headers);
  // Always serve the type recorded at upload (validated then), never a sniffed one.
  headers.set('content-type', SAFE_TYPES.test(item.mime) ? item.mime : 'application/octet-stream');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('cross-origin-resource-policy', 'same-site');
  return new Response(res.body, { status: res.status, headers });
};
