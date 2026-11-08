// GET /api/admin/media/watermark (admin only): current settings fingerprint and the photos that
// still need a watermarked copy.
import type { APIRoute } from 'astro';
import { getSetting, watermarkStatus } from '../../../../lib/server/repo';
import { json } from '../../../../lib/server/http';
import { watermarkSig } from '../../../../lib/shared/watermark';

export const GET: APIRoute = async () => {
  const sig = await watermarkSig(await getSetting('protection'));
  const status = await watermarkStatus(sig);
  return json({ sig, ...status });
};
