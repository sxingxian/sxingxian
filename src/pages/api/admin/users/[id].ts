// Owner only. PATCH /api/admin/users/:id { role?, disabled?, resetPassword?, reset2fa?, unlock? }
// You can't demote or disable yourself, and there must always be one enabled owner.
import type { APIRoute } from 'astro';
import { sql } from '../../../../lib/server/db';
import { error, json, readBody } from '../../../../lib/server/http';
import { userPatchSchema } from '../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../lib/shared/safe';
import { prehashPassword, randomPassword } from '../../../../lib/server/authcrypto';
import { clearThrottle, deleteSessionsForUser, enabledOwnerCount, logAuth, requestMeta } from '../../../../lib/server/users';

export const PATCH: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const me = locals.user!;
  if (me.role !== 'owner') return error(403, 'Only an owner can manage users.');
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) return error(400, 'Invalid id');
  const body = await readBody(request, userPatchSchema, 1024);
  if (!body.ok) return body.res;
  const p = body.data;

  const rows = await sql()`SELECT email, role, disabled FROM users WHERE id = ${id}`;
  const target = rows[0];
  if (!target) return error(404, 'User not found');
  const self = id === me.id;
  if (self && (p.disabled === true || p.role === 'admin' || p.resetPassword || p.reset2fa)) {
    return error(409, 'Use the Account page for your own account. You can’t demote or disable yourself.');
  }
  const losingOwner = target.role === 'owner' && !target.disabled && (p.role === 'admin' || p.disabled === true);
  if (losingOwner && (await enabledOwnerCount(id)) === 0) return error(409, 'There must always be at least one active owner.');

  const meta = requestMeta(request, clientAddress);
  const email = target.email as string;
  let temporaryPassword: string | undefined;

  if (p.role) await sql()`UPDATE users SET role = ${p.role}, updated_at = now() WHERE id = ${id}`;
  if (p.disabled !== undefined) {
    await sql()`UPDATE users SET disabled = ${p.disabled}, updated_at = now() WHERE id = ${id}`;
    if (p.disabled) await deleteSessionsForUser(id);
  }
  if (p.unlock) await clearThrottle(email);
  if (p.resetPassword) {
    temporaryPassword = randomPassword();
    const pre = await prehashPassword(temporaryPassword);
    await sql()`
      UPDATE users SET password_hash = crypt(${pre}, gen_salt('bf', 12)), must_change_password = true,
        password_changed_at = now(), updated_at = now()
      WHERE id = ${id}`;
    await clearThrottle(email);
    await deleteSessionsForUser(id);
  }
  if (p.reset2fa) {
    await sql()`UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, updated_at = now() WHERE id = ${id}`;
    await sql()`DELETE FROM recovery_codes WHERE user_id = ${id}`;
    await deleteSessionsForUser(id);
  }

  const what = [
    p.role && `role → ${p.role}`,
    p.disabled === true && 'disabled',
    p.disabled === false && 'enabled',
    p.unlock && 'unlocked',
    p.resetPassword && 'password reset',
    p.reset2fa && 'two-step sign-in reset',
  ].filter(Boolean).join(', ');
  if (what) await logAuth(me.id, me.email, `changed ${email}: ${what}`, true, meta);
  return json({ ok: true, ...(temporaryPassword ? { temporaryPassword } : {}) });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
