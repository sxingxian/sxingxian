// PUT /api/admin/media/:id/watermark (admin only). Body: the watermarked image (JPEG or WebP)
// drawn in the admin. Header X-Sx-Wm-Sig: the settings fingerprint it was drawn with, which must
// match the current settings. Stored next to the original as wm/<id>.<ext>.
import type { APIRoute } from 'astro';
import { getMedia, getSetting, setWatermarkCopy } from '../../../../../lib/server/repo';
import { deleteObject, putObject } from '../../../../../lib/server/storage';
import { error, json } from '../../../../../lib/server/http';
import { UUID_RE } from '../../../../../lib/shared/safe';
import { watermarkSig, watermarkable } from '../../../../../lib/shared/watermark';

const MAX = 20 * 1024 * 1024;

function sniff(b: Uint8Array): 'image/jpeg' | 'image/webp' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const PUT: APIRoute = async ({ params, request }) => {
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return error(404, 'Not found');
  const item = await getMedia(id);
  if (!item || !item.object_key || !watermarkable(item.mime) || (item.provider !== 'r2' && item.provider !== 'nas' && item.provider !== 'b2')) {
    return error(404, 'Not found');
  }
  const current = await watermarkSig(await getSetting('protection'));
  if (request.headers.get('X-Sx-Wm-Sig') !== current) return error(409, 'Watermark settings changed. Reload and try again.');

  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > MAX) return error(413, 'Image too large');
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX) return error(413, 'Image too large');
  const mime = sniff(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
  if (!mime) return error(415, 'Expected a JPEG or WebP image');

  const key = `wm/${id}.${mime === 'image/webp' ? 'webp' : 'jpg'}`;
  await putObject(item.provider, key, buf, mime);
  if (item.wm_key && item.wm_key !== key) await deleteObject(item.provider, item.wm_key).catch(() => {});
  await setWatermarkCopy(id, key, mime, current);
  return json({ ok: true });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
