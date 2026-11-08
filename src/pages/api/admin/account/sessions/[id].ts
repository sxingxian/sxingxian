// DELETE /api/admin/account/sessions/:id — sign out one of your other devices.
// :id is the first 16 hex characters of the stored session hash (never the token).
import type { APIRoute } from 'astro';
import { sql } from '../../../../../lib/server/db';
import { error, json } from '../../../../../lib/server/http';
import { logAuth, requestMeta } from '../../../../../lib/server/users';

export const DELETE: APIRoute = async ({ params, locals, request, clientAddress }) => {
  const id = params.id ?? '';
  if (!/^[0-9a-f]{16}$/.test(id)) return error(400, 'Invalid session id');
  const u = locals.user!;
  const rows = await sql()`
    DELETE FROM sessions WHERE user_id = ${u.id} AND left(token_hash, 16) = ${id} AND token_hash <> ${locals.sessionHash}
    RETURNING 1`;
  if (!rows.length) return error(404, 'Session not found');
  await logAuth(u.id, u.email, 'signed out another device', true, requestMeta(request, clientAddress));
  return json({ ok: true });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
