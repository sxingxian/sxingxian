// POST /api/auth/logout — ends this session (and only this one).
import type { APIRoute } from 'astro';
import { error, json } from '../../../lib/server/http';
import { clearSessionCookie, deleteSession, logAuth, requestMeta, sessionFromRequest } from '../../../lib/server/users';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const session = await sessionFromRequest(request).catch(() => null);
  if (session) {
    await deleteSession(session.tokenHash);
    await logAuth(session.user.id, session.user.email, 'signed out', true, requestMeta(request, clientAddress)).catch(() => {});
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
