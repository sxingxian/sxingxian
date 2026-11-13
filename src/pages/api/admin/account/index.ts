// GET   /api/admin/account → profile, 2FA status, sessions (activity: ./activity.ts, paged)
// PATCH /api/admin/account { name }
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sql } from '../../../../lib/server/db';
import { error, json, readBody } from '../../../../lib/server/http';
import { profileSchema } from '../../../../lib/shared/schemas';
import { authSecretProblem } from '../../../../lib/server/authcrypto';

export const GET: APIRoute = async ({ locals }) => {
  const u = locals.user!;
  const db = sql();
  const [info, sessions, codes] = await Promise.all([
    db`SELECT email, name, role, totp_enabled, must_change_password, last_login_at, password_changed_at, created_at FROM users WHERE id = ${u.id}`,
    db`SELECT left(token_hash, 16) AS id, token_hash = ${locals.sessionHash} AS current, created_at, last_seen_at, expires_at, ip, user_agent
       FROM sessions WHERE user_id = ${u.id} AND expires_at > now() ORDER BY last_seen_at DESC LIMIT 50`,
    db`SELECT count(*) FILTER (WHERE used_at IS NULL)::int AS left FROM recovery_codes WHERE user_id = ${u.id}`,
  ]);
  const secretProblem = authSecretProblem(env.AUTH_SECRET);
  return json({
    profile: info[0],
    totp: {
      enabled: info[0].totp_enabled,
      available: !secretProblem,
      unavailableReason: secretProblem ? `${secretProblem}. Add it to the Worker in Cloudflare (32+ random characters) to turn this on.` : '',
      recoveryCodesLeft: codes[0].left,
    },
    sessions,
  });
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const body = await readBody(request, profileSchema, 2048);
  if (!body.ok) return body.res;
  await sql()`UPDATE users SET name = ${body.data.name}, updated_at = now() WHERE id = ${locals.user!.id}`;
  return json({ ok: true });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
