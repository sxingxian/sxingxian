// First-account setup. Works only while the users table is empty AND the Worker
// secret SETUP_TOKEN is set (24+ characters). After the first account exists it is
// permanently closed, whatever the token.
//   GET  /api/auth/setup → { available }
//   POST /api/auth/setup { token, name, email, password } → owner account + session
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { error, json, readBody } from '../../../lib/server/http';
import { setupSchema } from '../../../lib/shared/schemas';
import { passwordProblem, prehashPassword, safeEqual } from '../../../lib/server/authcrypto';
import { sql } from '../../../lib/server/db';
import { createSession, logAuth, requestMeta, sessionCookie, userCount, withinLoginLimit } from '../../../lib/server/users';

const tokenConfigured = () => (env.SETUP_TOKEN ?? '').length >= 24;

export const GET: APIRoute = async () => {
  const available = tokenConfigured() && (await userCount()) === 0;
  return json({ available, tokenConfigured: tokenConfigured() });
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const meta = requestMeta(request, clientAddress);
  if (!(await withinLoginLimit(meta.ip))) return error(429, 'Too many attempts. Wait a minute and try again.');
  if (!tokenConfigured() || (await userCount()) > 0) return error(404, 'Setup is not available.');

  const body = await readBody(request, setupSchema, 4096);
  if (!body.ok) return body.res;
  const { token, name, email, password } = body.data;

  if (!safeEqual(token.trim(), env.SETUP_TOKEN!)) {
    await logAuth(null, email, 'setup (wrong token)', false, meta);
    return error(403, 'The setup token is not correct.');
  }
  const problem = passwordProblem(password, email);
  if (problem) return error(422, problem);

  // One transaction under an advisory lock, so two setup requests can't both create an owner.
  const pre = await prehashPassword(password);
  const [, inserted] = await sql().transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(727275)`,
    tx`INSERT INTO users (email, name, role, password_hash, last_login_at)
       SELECT ${email}, ${name}, 'owner', crypt(${pre}, gen_salt('bf', 12)), now()
       WHERE NOT EXISTS (SELECT 1 FROM users)
       RETURNING id`,
  ]);
  const id = inserted[0]?.id as string | undefined;
  if (!id) return error(404, 'Setup is not available.');

  await logAuth(id, email, 'account created (setup)', true, meta);
  const session = await createSession(id, meta);
  return json({ ok: true }, { status: 201, headers: { 'Set-Cookie': sessionCookie(session) } });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
