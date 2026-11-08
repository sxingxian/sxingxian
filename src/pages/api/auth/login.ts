// POST /api/auth/login  { email, password, code? }
// 200 { ok, mustChangePassword } + session cookie | 200 { mfa: true } | 401 | 429
import type { APIRoute } from 'astro';
import { error, json, readBody } from '../../../lib/server/http';
import { loginSchema } from '../../../lib/shared/schemas';
import { attemptLogin, createSession, requestMeta, sessionCookie, withinLoginLimit } from '../../../lib/server/users';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const meta = requestMeta(request, clientAddress);
  if (!(await withinLoginLimit(meta.ip))) return error(429, 'Too many attempts. Wait a minute and try again.');

  const body = await readBody(request, loginSchema, 4096);
  if (!body.ok) return body.res;
  const { email, password, code } = body.data;
  if (!email || !password) return error(422, 'Enter your email and password.');

  const result = await attemptLogin(email, password, code || undefined, meta);
  switch (result.kind) {
    case 'mfa':
      return json({ mfa: true });
    case 'locked':
      return error(429, `Too many failed attempts. Try again in ${result.minutes} minute${result.minutes === 1 ? '' : 's'}.`);
    case 'invalid':
      return error(401, result.message);
    case 'ok': {
      const token = await createSession(result.userId, meta);
      return json(
        { ok: true, mustChangePassword: result.mustChangePassword, usedRecovery: result.usedRecovery },
        { headers: { 'Set-Cookie': sessionCookie(token) } },
      );
    }
  }
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
