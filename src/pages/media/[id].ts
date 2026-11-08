// Serves uploaded media from whichever host it was stored on (R2, NAS, B2).
// Storage credentials stay on the server; the browser only ever sees /media/:id.
//
// Photo protection (Settings → Photos):
//  - Watermark on: photos are served from their watermarked copy (capped at 2560 px). The original is
//    never served here; until a copy exists the photo is served as is and the admin lists it as pending.
//  - Block saving on: opening an image address directly in a tab, or embedding it on another site,
//    is refused. Link previews and feed readers (which send no Sec-Fetch headers) still work.
import type { APIRoute } from 'astro';
import { getMedia, getSetting } from '../../lib/server/repo';
import { getObject } from '../../lib/server/storage';
import { UUID_RE } from '../../lib/shared/safe';
import { watermarkSig, watermarkable } from '../../lib/shared/watermark';

const SAFE_TYPES = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm))$/;

function refused(): Response {
  return new Response('This image can only be viewed on the page it belongs to.', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });
  const item = await getMedia(id);
  if (!item || !item.object_key || (item.provider !== 'r2' && item.provider !== 'nas' && item.provider !== 'b2')) {
    return new Response('Not found', { status: 404 });
  }

  const protection = await getSetting('protection');
  if (protection.blockSave) {
    const dest = request.headers.get('Sec-Fetch-Dest');
    const site = request.headers.get('Sec-Fetch-Site');
    if (dest === 'document' || dest === 'iframe' || site === 'cross-site') return refused();
  }

  let key = item.object_key;
  let mime = item.mime;
  if (protection.watermark && watermarkable(item.mime) && item.wm_key && item.wm_mime && item.wm_sig === (await watermarkSig(protection))) {
    key = item.wm_key;
    mime = item.wm_mime;
  }

  const res = await getObject(item.provider, key, request);
  if (!res) return new Response('Not found', { status: 404 });

  const headers = new Headers(res.headers);
  // Always serve the type recorded at upload (validated then), never a sniffed one.
  headers.set('content-type', SAFE_TYPES.test(mime) ? mime : 'application/octet-stream');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  headers.set('content-disposition', 'inline');
  // Short cache: switching the watermark on or off must reach visitors within the hour.
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('vary', 'Sec-Fetch-Dest, Sec-Fetch-Site');
  headers.set('cross-origin-resource-policy', 'same-site');
  return new Response(res.body, { status: res.status, headers });
};
