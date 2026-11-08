// GET /api/admin/geocode?q=… → up to 6 places from OpenStreetMap Nominatim (admin only).
// Called on Enter only (never per keystroke), within Nominatim's usage policy.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { error, json } from '../../../lib/server/http';
import { validMapPoint } from '../../../lib/shared/safe';

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  if (q.length < 2) return error(422, 'Type a place name');
  const target = new URL('https://nominatim.openstreetmap.org/search');
  target.search = new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '0' }).toString();
  let res: Response;
  try {
    res = await fetch(target, {
      headers: { 'User-Agent': `sxingxian-admin/1.0 (+${env.SITE_URL})`, Accept: 'application/json', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return error(502, 'Map search is unavailable. Paste coordinates or a map link instead.');
  }
  if (!res.ok) return error(502, 'Map search is unavailable. Paste coordinates or a map link instead.');
  const rows = (await res.json().catch(() => [])) as { display_name?: unknown; lat?: unknown; lon?: unknown }[];
  const places = (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const p = validMapPoint(r.lat, r.lon);
      return p && typeof r.display_name === 'string' ? { label: r.display_name.slice(0, 200), lat: p.lat, lon: p.lon } : null;
    })
    .filter(Boolean);
  return json({ places });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
