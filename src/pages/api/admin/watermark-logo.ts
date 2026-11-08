// The watermark logo (admin only; the middleware enforces sign-in and the CSRF header on writes).
//   GET    → the PNG, for drawing watermarks in the admin. Never public.
//   PUT    → body: a PNG (≤256 KB, ≤1024 px). Replaces the logo and updates protection.logoHash.
//   DELETE → removes the logo.
// Stored in Neon (one row): there is only ever one logo, and it's tiny.
import type { APIRoute } from 'astro';
import { deleteWatermarkLogo, getSetting, getWatermarkLogo, putSetting, putWatermarkLogo } from '../../../lib/server/repo';
import { error, json } from '../../../lib/server/http';
import { LOGO_MAX_BYTES, checkPng, sha256Hex } from '../../../lib/server/png';

export const GET: APIRoute = async () => {
  const logo = await getWatermarkLogo();
  if (!logo) return error(404, 'No logo');
  return new Response(logo.data, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-cache',
      ETag: `"${logo.sha256.slice(0, 16)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
};

export const PUT: APIRoute = async ({ request }) => {
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim() !== 'image/png') return error(415, 'Send the logo as a PNG');
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > LOGO_MAX_BYTES) return error(413, 'Logo must be under 256 KB');
  const buf = new Uint8Array(await request.arrayBuffer());
  const check = checkPng(buf);
  if (!check.ok) return error(buf.byteLength > LOGO_MAX_BYTES ? 413 : 415, check.reason);
  const sha = await sha256Hex(buf);
  await putWatermarkLogo(buf, sha, check.width, check.height);
  const p = await getSetting('protection');
  const value = { ...p, logoHash: sha.slice(0, 16) };
  await putSetting('protection', value);
  return json({ value, width: check.width, height: check.height });
};

export const DELETE: APIRoute = async () => {
  const p = await getSetting('protection');
  if (p.watermark && !p.text.trim()) return error(409, 'Add watermark text before removing the logo');
  await deleteWatermarkLogo();
  const value = { ...p, logoHash: null };
  await putSetting('protection', value);
  return json({ value });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
