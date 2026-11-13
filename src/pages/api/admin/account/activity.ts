// GET /api/admin/account/activity?page=&size= → your sign-ins and security changes, newest first (kept 180 days).
import type { APIRoute } from 'astro';
import { sql } from '../../../../lib/server/db';
import { error, json } from '../../../../lib/server/http';
import { readPaging } from '../../../../lib/shared/paging';

export const GET: APIRoute = async ({ url, locals }) => {
  const u = locals.user!;
  const { page, size, offset } = readPaging(url.searchParams);
  const [events, n] = await Promise.all([
    sql()`SELECT event, ok, ip, user_agent, at FROM auth_events WHERE user_id = ${u.id} ORDER BY at DESC, id DESC LIMIT ${size} OFFSET ${offset}`,
    sql()`SELECT count(*)::int AS n FROM auth_events WHERE user_id = ${u.id}`,
  ]);
  return json({ events, total: Number(n[0]?.n ?? 0), page, size });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
