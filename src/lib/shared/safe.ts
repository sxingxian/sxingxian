// Small, dependency-free safety helpers shared by server and admin.

/**
 * Links we are willing to render: https URLs, mailto:, and site-relative paths.
 * Rejects javascript:, data:, vbscript:, protocol-relative (//evil.com) and
 * anything with control characters or whitespace tricks.
 */
export function isSafeHref(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const url = raw.trim();
  if (url.length === 0 || url.length > 2048) return false;
  if (/[\u0000-\u001F\u007F\s]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\');
  if (url.startsWith('#')) return true;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

/** URL-safe slug from any title. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

// Linear-time in practice (each repetition starts with a literal '-'); callers
// also cap input length via isSlug() before matching.
// eslint-disable-next-line security/detect-unsafe-regex
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (s: string): boolean => s.length > 0 && s.length <= 80 && SLUG_RE.test(s);
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only these embed providers/IDs are ever rendered as iframes. */
export type VideoProvider = 'youtube' | 'vimeo' | 'tiktok';
export interface ParsedVideo { provider: VideoProvider; id: string; portrait: boolean }

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const TIKTOK_ID = /^\d{15,25}$/;

/** YouTube (incl. Shorts), Vimeo and TikTok links → provider + id. Anything else → null. */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parts[0] === 'shorts') return YT_ID.test(parts[1] ?? '') ? { provider: 'youtube', id: parts[1], portrait: true } : null;
      if (parts[0] === 'live' || parts[0] === 'embed') return YT_ID.test(parts[1] ?? '') ? { provider: 'youtube', id: parts[1], portrait: false } : null;
      const id = u.searchParams.get('v');
      return id && YT_ID.test(id) ? { provider: 'youtube', id, portrait: false } : null;
    }
    if (host === 'youtu.be') {
      const id = parts[0] ?? '';
      return YT_ID.test(id) ? { provider: 'youtube', id, portrait: false } : null;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = parts[parts.length - 1] ?? '';
      return VIMEO_ID.test(id) ? { provider: 'vimeo', id, portrait: false } : null;
    }
    if (host === 'tiktok.com' || host === 'm.tiktok.com') {
      // /@user/video/<id>, /@user/photo/<id>, /player/v1/<id>, /embed/v2/<id>
      const i = parts.findIndex((p) => p === 'video' || p === 'photo' || p === 'v1' || p === 'v2');
      const id = i >= 0 ? parts[i + 1] ?? '' : '';
      return TIKTOK_ID.test(id) ? { provider: 'tiktok', id, portrait: true } : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** TikTok share links (vm.tiktok.com/…, vt.tiktok.com/…, tiktok.com/t/…) hide the video id behind a redirect. */
export function isTikTokShortLink(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^www\./, '');
    return host === 'vm.tiktok.com' || host === 'vt.tiktok.com' || (host === 'tiktok.com' && u.pathname.startsWith('/t/'));
  } catch {
    return false;
  }
}

export function embedSrc(provider: VideoProvider, id: string): string | null {
  if (provider === 'youtube' && YT_ID.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === 'vimeo' && VIMEO_ID.test(id)) return `https://player.vimeo.com/video/${id}?dnt=1`;
  if (provider === 'tiktok' && TIKTOK_ID.test(id)) return `https://www.tiktok.com/player/v1/${id}?rel=0&description=1`;
  return null;
}

// ------------------------------------------------------------------ maps

export interface MapPoint { lat: number; lon: number; zoom: number }

export function validMapPoint(lat: unknown, lon: unknown, zoom: unknown = 15): MapPoint | null {
  const la = typeof lat === 'string' ? Number(lat) : lat;
  const lo = typeof lon === 'string' ? Number(lon) : lon;
  const z = typeof zoom === 'string' ? Number(zoom) : zoom;
  if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -85 || la > 85 || lo < -180 || lo > 180) return null;
  const zz = typeof z === 'number' && Number.isFinite(z) ? Math.round(Math.min(19, Math.max(2, z))) : 15;
  return { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6, zoom: zz };
}

/**
 * Coordinates ("1.2834, 103.8607") or a Google Maps / OpenStreetMap / Apple Maps link
 * that carries coordinates → a map point. Place names need a search instead.
 */
export function parseMapInput(raw: string): MapPoint | null {
  const t = raw.trim();
  if (t.length > 2000) return null;
  const num = (v: string | undefined) => (v && /^-?[\d.]+$/.test(v.trim()) ? Number(v.trim()) : NaN);
  const pairOf = (v: string): MapPoint | null => {
    const parts = v.split(',');
    return parts.length === 2 ? validMapPoint(num(parts[0]), num(parts[1])) : null;
  };
  const direct = pairOf(t);
  if (direct) return direct;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const s = decodeURIComponent(u.href);
  // Google: …/@lat,lon,17z/…
  const at = s.split('@')[1]?.split('/')[0]?.split(',');
  if (at && at.length >= 2) {
    const zoom = at[2]?.endsWith('z') ? num(at[2].slice(0, -1)) : 15;
    const p = validMapPoint(num(at[0]), num(at[1]), Number.isFinite(zoom) ? zoom : 15);
    if (p) return p;
  }
  // Google place data: …!3d<lat>!4d<lon>…
  const d3 = s.split('!3d')[1]?.split('!')[0];
  const d4 = s.split('!4d')[1]?.split('!')[0];
  if (d3 && d4) {
    const p = validMapPoint(num(d3), num(d4), 16);
    if (p) return p;
  }
  // OpenStreetMap: #map=15/lat/lon
  if (u.hash.startsWith('#map=')) {
    const [z, la, lo] = u.hash.slice(5).split('/');
    const p = validMapPoint(num(la), num(lo), num(z));
    if (p) return p;
  }
  const q = u.searchParams.get('q') ?? u.searchParams.get('ll') ?? u.searchParams.get('query') ?? '';
  const fromQuery = q ? pairOf(q) : null;
  if (fromQuery) return validMapPoint(fromQuery.lat, fromQuery.lon, num(u.searchParams.get('z') ?? '15'));
  const mlat = u.searchParams.get('mlat');
  const mlon = u.searchParams.get('mlon');
  if (mlat && mlon) return validMapPoint(num(mlat), num(mlon));
  return null;
}

/** OpenStreetMap embed (no API key, no tracking cookies), sized for a ~700×400 frame. */
export function osmEmbedSrc(p: MapPoint): string {
  const lonSpan = ((700 / 256) * 360) / 2 ** p.zoom;
  const latSpan = lonSpan * Math.cos((p.lat * Math.PI) / 180) * (400 / 700);
  const f = (n: number) => n.toFixed(6);
  const bbox = [p.lon - lonSpan / 2, p.lat - latSpan / 2, p.lon + lonSpan / 2, p.lat + latSpan / 2].map(f).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${f(p.lat)},${f(p.lon)}`;
}

export function osmLink(p: MapPoint): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=${p.zoom}/${p.lat}/${p.lon}`;
}
