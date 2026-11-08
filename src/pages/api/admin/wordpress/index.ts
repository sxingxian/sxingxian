import type { APIRoute } from 'astro';
import { z } from 'zod';
import { sql } from '../../../../lib/server/db';
import { adminListExternalPosts, setExternalVisibility } from '../../../../lib/server/repo';
import { healthCheck, reconcile, syncIncremental } from '../../../../lib/server/wordpress';
import { error, json, readBody } from '../../../../lib/server/http';

export const GET: APIRoute = async () => {
  const [source] = await sql()`SELECT status, status_since, consecutive_fail, consecutive_ok, last_check_at, last_check_ms, last_sync_at FROM sources WHERE id = 'wordpress'`;
  const log = await sql()`SELECT at, event, result, ok FROM sync_log ORDER BY at DESC LIMIT 40`;
  const posts = await adminListExternalPosts();
  return json({ source, log, posts });
};

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({ action: z.literal('reconcile') }),
  z.object({ action: z.literal('check') }),
  z.object({ action: z.literal('visibility'), wp_id: z.number().int().positive(), show: z.boolean() }),
]);

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, actionSchema, 1000);
  if (!body.ok) return body.res;
  const a = body.data;
  switch (a.action) {
    case 'sync':
      await syncIncremental('Manual sync');
      break;
    case 'reconcile':
      await reconcile();
      break;
    case 'check':
      await healthCheck();
      break;
    case 'visibility':
      await setExternalVisibility(a.wp_id, a.show);
      break;
    default:
      return error(400, 'Unknown action');
  }
  return json({ ok: true });
};
