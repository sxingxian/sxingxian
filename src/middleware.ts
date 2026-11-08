// Runs on every server-rendered request.
//  1. Protects /admin and /api/admin with Cloudflare Access JWT verification.
//  2. Blocks cross-site writes to the admin API (Origin check + custom header).
//  3. Adds security headers and a strict, per-request-nonce Content Security Policy.
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { verifyAdmin } from './lib/server/auth';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/') || path === '/api/admin';
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

function buildCsp(nonce: string): string {
  const wp = originOf(env.WP_BASE_URL);
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${wp} https://*.wp.com https://i.ytimg.com https://i.vimeocdn.com`,
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
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

  if (admin) {
    const auth = await verifyAdmin(request);
    if (!auth.ok) {
      const isApi = path.startsWith('/api/');
      return new Response(isApi ? JSON.stringify({ error: 'Unauthorised' }) : 'Unauthorised. Sign in through Cloudflare Access.', {
        status: 401,
        headers: {
          'content-type': isApi ? 'application/json' : 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          ...BASE_HEADERS,
        },
      });
    }
    context.locals.adminEmail = auth.email;

    if (path.startsWith('/api/admin') && MUTATING.has(request.method)) {
      const origin = request.headers.get('Origin');
      const sameOrigin = origin === url.origin;
      // A custom header cannot be sent cross-site without a CORS preflight,
      // which this API never grants.
      const marked = request.headers.get('X-Sx-Admin') === '1';
      if (!sameOrigin || !marked) {
        return new Response(JSON.stringify({ error: 'Cross-site request blocked' }), {
          status: 403,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...BASE_HEADERS },
        });
      }
    }
  }

  const nonce = makeNonce();
  context.locals.cspNonce = nonce;

  const response = await next();
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  if (admin) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  const type = headers.get('content-type') ?? '';
  if (!type.includes('text/html') || !response.body) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  headers.set('Content-Security-Policy', buildCsp(nonce));
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
