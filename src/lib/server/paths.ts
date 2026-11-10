// Request-path canonicalisation for access-control decisions.
// The router matches on a decoded path while URL.pathname stays percent-encoded, so a check on the raw
// string (e.g. "/api/%61dmin/...") can disagree with the route that actually runs. Decide on the
// fully decoded, normalised path instead, and refuse anything that cannot be normalised cleanly.

const MAX_DECODE_PASSES = 4;

/** Returns the canonical path, or null if it is malformed or still changing after repeated decoding. */
export function canonicalPath(raw: string): string | null {
  let p = raw;
  for (let i = 0; ; i++) {
    let d: string;
    try {
      d = decodeURIComponent(p);
    } catch {
      return null;
    }
    if (d === p) break;
    if (i >= MAX_DECODE_PASSES) return null;
    p = d;
  }
  if (p.includes('\0')) return null;
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  const trailing = p.length > 1 && /[\\/]$/.test(p) && out.length > 0;
  return '/' + out.join('/') + (trailing ? '/' : '');
}

/** True for the admin pages and admin/auth APIs, from either the canonical path or the matched route. */
export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/') || path === '/api/admin' || path.startsWith('/api/admin/');
}
