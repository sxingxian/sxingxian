// Runs on every server-rendered request.
//  1. Protects /admin and /api/admin with the admin session (accounts in Neon).
//  2. Blocks cross-site writes to the admin and sign-in APIs (Origin check + custom header).
//  3. Adds security headers and a strict, per-request-nonce Content Security Policy.
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { sessionFromRequest } from './lib/server/users';
import { maintenanceOnRequest } from './lib/server/maintenance';
import { adsFor } from './lib/server/ads';
import { wpBase } from './lib/server/wordpress';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Pages anyone may open (they only show a form). Everything else under /admin needs a session.
const PUBLIC_ADMIN_PAGES = new Set(['/admin/login', '/admin/setup']);

// While a user must change a temporary password, only these work.
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/admin/me', '/api/admin/account/password', '/admin/account']);

function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/') || path === '/api/admin';
}

function isAuthApi(path: string): boolean {
  return path.startsWith('/api/auth/');
}

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

// Pages with Google AdSense use Google's supported strict CSP (support.google.com/adsense/answer/16283098):
// a fresh nonce plus 'strict-dynamic' for scripts. Ad code loads from domains Google changes over time, so
// images, frames and connections allow any https: origin on those pages only. 'unsafe-inline', https: and
// http: in script-src are fallbacks for old browsers; modern ones ignore them when a nonce and
// 'strict-dynamic' are present. The admin and pages without ads keep the tight policy below.
function buildAdsCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'unsafe-eval' https: http:`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' https:",
    "connect-src 'self' https:",
    "media-src 'self' blob: https:",
    "worker-src 'self'",
    'frame-src https:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function buildCsp(nonce: string, wpAddress: string): string {
  const wp = originOf(wpAddress);
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${wp} https://*.wp.com https://i.ytimg.com https://i.vimeocdn.com`,
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.tiktok.com https://www.openstreetmap.org',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const path = url.pathname;
  const admin = isAdminPath(path);

  const isApi = path.startsWith('/api/');
  const deny = (status: number, message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...BASE_HEADERS },
    });

  // CSRF: writes must come from this site's own pages. A custom header cannot be sent
  // cross-site without a CORS preflight, which this API never grants. The session
  // cookie is also SameSite=Strict.
  if ((path.startsWith('/api/admin') || isAuthApi(path)) && MUTATING.has(request.method)) {
    const sameOrigin = request.headers.get('Origin') === url.origin;
    const marked = request.headers.get('X-Sx-Admin') === '1';
    if (!sameOrigin || !marked) return deny(403, 'Cross-site request blocked');
  }

  if (admin && !PUBLIC_ADMIN_PAGES.has(path)) {
    let session = null;
    try {
      session = await sessionFromRequest(request, (p) => context.locals.cfContext?.waitUntil(p));
    } catch {
      return isApi ? deny(503, 'Database unavailable') : new Response('The admin is temporarily unavailable.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...BASE_HEADERS } });
    }
    if (!session) {
      if (isApi) return deny(401, 'Unauthorised');
      const next = path === '/admin' || path === '/admin/' ? '' : `?next=${encodeURIComponent(path + url.search)}`;
      return new Response(null, { status: 303, headers: { Location: `/admin/login${next}`, 'cache-control': 'no-store', ...BASE_HEADERS } });
    }
    if (session.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(path)) {
      if (isApi) return deny(403, 'Change your temporary password first');
      return new Response(null, { status: 303, headers: { Location: '/admin/account', 'cache-control': 'no-store', ...BASE_HEADERS } });
    }
    context.locals.user = session.user;
    context.locals.sessionHash = session.tokenHash;
  }

  // Start any due background job (WordPress health check, sync, clean-up) after this
  // response. Not for the webhook or sign-in endpoints, so they can't be used to drive it.
  if (request.method === 'GET' && !path.startsWith('/api/hooks/') && !isAuthApi(path)) {
    maintenanceOnRequest((p) => context.locals.cfContext?.waitUntil(p));
  }

  const nonce = makeNonce();
  context.locals.cspNonce = nonce;

  const response = await next();
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  if (admin || isAuthApi(path)) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  const type = headers.get('content-type') ?? '';
  if (!type.includes('text/html') || !response.body) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  const ads = !admin && request.method === 'GET' ? await adsFor(path) : null;
  let wpAddress = env.WP_BASE_URL;
  if (!ads) {
    try { wpAddress = await wpBase(); } catch { /* fall back to the Cloudflare value */ }
  }
  headers.set('Content-Security-Policy', ads ? buildAdsCsp(nonce) : buildCsp(nonce, wpAddress));
  // Ad clicks open the advertiser in a new tab; keep that working on ad pages.
  if (ads) headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  headers.delete('content-length');
  const tagged = new Response(response.body, { status: response.status, statusText: response.statusText, headers });

  // Stamp the nonce on every <script> Astro emitted (island loaders, bundles).
  // User content never produces <script> tags: the renderer is an allow-list.
  return new HTMLRewriter()
    .on('script', {
      element(el) {
        el.setAttribute('nonce', nonce);
      },
    })
    .transform(tagged);
});
