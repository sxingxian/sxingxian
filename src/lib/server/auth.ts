// SERVER-ONLY. Admin authentication = Cloudflare Access (Zero Trust).
//
// Cloudflare Access sits in front of sxingxian.com/admin* and /api/admin*. It
// performs the login (one-time PIN, Google, GitHub…) and forwards a signed JWT.
// We verify that JWT ourselves on every request — signature (Access JWKS),
// issuer, audience, expiry — and then check the email against ADMIN_EMAILS.
// If Access were ever misconfigured or bypassed, requests still fail here.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from 'cloudflare:workers';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksDomain = '';

function getJwks(teamDomain: string) {
  if (!jwks || jwksDomain !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    jwksDomain = teamDomain;
  }
  return jwks;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export type AuthResult = { ok: true; email: string } | { ok: false; reason: string };

export async function verifyAdmin(request: Request): Promise<AuthResult> {
  // Local development escape hatch. `import.meta.env.DEV` is a build-time
  // constant: in a production build this whole branch is removed.
  if (import.meta.env.DEV && env.DEV_AUTH_BYPASS === 'true') {
    const host = new URL(request.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return { ok: true, email: 'dev@localhost' };
  }

  const team = (env.ACCESS_TEAM_DOMAIN ?? '').trim();
  const aud = (env.ACCESS_AUD ?? '').trim();
  if (!team || team.startsWith('REPLACE') || !aud) return { ok: false, reason: 'Access is not configured' };

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ?? readCookie(request.headers.get('Cookie'), 'CF_Authorization');
  if (!token) return { ok: false, reason: 'Missing Access token' };

  try {
    const { payload } = await jwtVerify(token, getJwks(team), {
      issuer: `https://${team}`,
      audience: aud,
      algorithms: ['RS256'],
      clockTolerance: 30,
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const allowed = (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!email || !allowed.includes(email)) return { ok: false, reason: 'Not an allowed admin' };
    return { ok: true, email };
  } catch {
    return { ok: false, reason: 'Invalid Access token' };
  }
}
