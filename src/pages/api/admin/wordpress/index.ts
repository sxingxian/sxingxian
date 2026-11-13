import type { APIRoute } from 'astro';
import { z } from 'zod';
import { sql } from '../../../../lib/server/db';
import { pageExternalPosts, setExternalVisibility } from '../../../../lib/server/repo';
import { readPaging } from '../../../../lib/shared/paging';
import { healthCheck, probeWordPress, reconcile, refreshSyncedPosts, resyncAfterAddressChange, syncIncremental, wpBase } from '../../../../lib/server/wordpress';
import { getSetting, putSetting } from '../../../../lib/server/repo';
import { normalizeWpBase } from '../../../../lib/shared/safe';
import { error, json, readBody } from '../../../../lib/server/http';

// ?page=&size= pages the synced posts; ?logpage=&logsize= pages the activity log (kept 30 days).
export const GET: APIRoute = async ({ url }) => {
  const posts = readPaging(url.searchParams);
  const log = readPaging(url.searchParams, 'log');
  const [[source], logRows, logCount, synced] = await Promise.all([
    sql()`SELECT status, status_since, consecutive_fail, consecutive_ok, last_check_at, last_check_ms, last_sync_at FROM sources WHERE id = 'wordpress'`,
    sql()`SELECT at, event, result, ok FROM sync_log ORDER BY at DESC, id DESC LIMIT ${log.size} OFFSET ${log.offset}`,
    sql()`SELECT count(*)::int AS n FROM sync_log`,
    pageExternalPosts(posts.size, posts.offset),
  ]);
  let address = '';
  try { address = await wpBase(); } catch { address = ''; }
  return json({ source, log: logRows, logTotal: Number(logCount[0]?.n ?? 0), posts: synced.posts, postsTotal: synced.total, address });
};

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({ action: z.literal('reconcile') }),
  z.object({ action: z.literal('check') }),
  z.object({ action: z.literal('remap') }),
  z.object({ action: z.literal('probe'), url: z.string().max(200) }),
  z.object({ action: z.literal('address'), url: z.string().max(200) }),
  z.object({ action: z.literal('visibility'), wp_id: z.number().int().positive(), show: z.boolean() }),
]);

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, actionSchema, 1000);
  if (!body.ok) return body.res;
  const a = body.data;
  switch (a.action) {
    case 'sync': {
      // Pull recent changes, then refresh every synced post's topic and featured image, so changes
      // WordPress didn't flag as edits (featured image, mapping) are picked up too.
      await syncIncremental('Manual sync');
      try {
        const { updated } = await refreshSyncedPosts('Manual sync: topics and images');
        return json({ ok: true, remapped: updated });
      } catch {
        return json({ ok: true, remapped: null });
      }
    }
    case 'reconcile':
      await reconcile();
      break;
    case 'check':
      await healthCheck();
      break;
    case 'remap':
      try {
        return json({ ok: true, ...(await refreshSyncedPosts('Category mapping applied')) });
      } catch {
        return error(502, 'couldn’t reach WordPress to update existing posts. Save again once it’s back.');
      }
    case 'probe':
      return json(await probeWordPress(a.url));
    case 'address': {
      const root = normalizeWpBase(a.url);
      if (!root) return error(422, 'Use a public https address, like https://hey.example.com');
      const probe = await probeWordPress(root);
      if (!probe.ok) return error(422, probe.error);
      const current = await getSetting('wordpress');
      await putSetting('wordpress', { ...current, baseUrl: root });
      await resyncAfterAddressChange();
      return json({ ok: true, address: root, name: probe.name });
    }
    case 'visibility':
      await setExternalVisibility(a.wp_id, a.show);
      break;
    default:
      return error(400, 'Unknown action');
  }
  return json({ ok: true });
};
