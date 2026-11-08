// GET /api/admin/media/:id/original (admin only): the untouched upload, used by the admin to
// draw a watermarked copy. The public /media/:id route never serves it while the watermark is on.
import type { APIRoute } from 'astro';
import { getMedia } from '../../../../../lib/server/repo';
import { getObject } from '../../../../../lib/server/storage';
import { error } from '../../../../../lib/server/http';
import { UUID_RE } from '../../../../../lib/shared/safe';
import { watermarkable } from '../../../../../lib/shared/watermark';

export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return error(404, 'Not found');
  const item = await getMedia(id);
  if (!item || !item.object_key || !watermarkable(item.mime) || (item.provider !== 'r2' && item.provider !== 'nas' && item.provider !== 'b2')) {
    return error(404, 'Not found');
  }
  const res = await getObject(item.provider, item.object_key, new Request(request.url));
  if (!res || !res.body) return error(404, 'Not found');
  return new Response(res.body, {
    headers: { 'content-type': item.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" },
  });
};
