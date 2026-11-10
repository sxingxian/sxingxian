// Owner only.
//   GET  /api/admin/users → all admin accounts
//   POST /api/admin/users { email, name, role } → creates the account with a temporary
//        password, returned ONCE. The new user must change it at first sign-in.
import type { APIRoute } from 'astro';
import { sql } from '../../../../lib/server/db';
import { error, isUniqueViolation, json, readBody } from '../../../../lib/server/http';
import { userCreateSchema } from '../../../../lib/shared/schemas';
import { prehashPassword, randomPassword } from '../../../../lib/server/authcrypto';
import { logAuth, requestMeta } from '../../../../lib/server/users';

export const GET: APIRoute = async ({ locals }) => {
  if (locals.user!.role !== 'owner') return error(403, 'Only an owner can manage users.');
  const users = await sql()`
    SELECT u.id, u.email, u.name, u.role, u.disabled, u.totp_enabled, u.must_change_password, u.last_login_at, u.created_at,
           EXISTS (SELECT 1 FROM login_throttle t WHERE t.email = u.email AND t.locked_until > now()) AS locked,
           (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
    FROM users u ORDER BY u.created_at`;
  return json({ users });
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const me = locals.user!;
  if (me.role !== 'owner') return error(403, 'Only an owner can manage users.');
  const body = await readBody(request, userCreateSchema, 2048);
  if (!body.ok) return body.res;
  const { email, name, role } = body.data;
  const temporary = randomPassword();
  const pre = await prehashPassword(temporary);
  try {
    const rows = await sql()`
      INSERT INTO users (email, name, role, password_hash, must_change_password)
      VALUES (${email}, ${name}, ${role}, crypt(${pre}, gen_salt('bf', 12)), true)
      RETURNING id`;
    await logAuth(me.id, me.email, `added user ${email} (${role})`, true, requestMeta(request, clientAddress));
    return json({ id: rows[0].id, temporaryPassword: temporary }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return error(409, 'An account with that email already exists.');
    throw e;
  }
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
