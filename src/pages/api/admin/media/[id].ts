import type { APIRoute } from 'astro';
import { deleteMediaRow, getMedia } from '../../../../lib/server/repo';
import { deleteObject } from '../../../../lib/server/storage';
import { error, json } from '../../../../lib/server/http';
import { UUID_RE } from '../../../../lib/shared/safe';

export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return error(404, 'Not found');
  const item = await getMedia(id);
  if (!item) return error(404, 'Not found');
  if (item.object_key && (item.provider === 'r2' || item.provider === 'nas' || item.provider === 'b2')) {
    await deleteObject(item.provider, item.object_key);
  }
  await deleteMediaRow(id);
  return json({ ok: true });
};
