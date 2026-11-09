// SERVER-ONLY. Sync public posts from the WordPress site (hey.sxingxian.com)
// into external_posts, and track its health.
//
//  • Webhook   — the WP plugin pings us with a post ID; we fetch that post back
//                from the WP REST API ourselves (payload content is never trusted).
//  • Incremental pull every 15 min — posts modified since the last sync.
//  • Nightly reconcile — marks posts deleted/trashed/privatised on WP as removed.
//  • Health check every 5 min — 2 failures → down (posts hidden), 2 OKs → up.
import { env } from 'cloudflare:workers';
import { sql } from './db';
import { getSetting } from './repo';
import { htmlToText } from './text';
import { normalizeWpBase } from '../shared/safe';

const UA = 'sxingxian-sync/1.0 (+https://sxingxian.com)';
const FAILS_TO_DOWN = 2;
const OKS_TO_UP = 2;

interface WpPost {
  id: number;
  slug: string;
  status: string;
  link: string;
  date_gmt: string;
  modified_gmt: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  categories?: number[];
  _embedded?: {
    'wp:featuredmedia'?: { source_url?: string; media_details?: { sizes?: Record<string, { source_url?: string }> } }[];
    'wp:term'?: { id: number; name: string; taxonomy: string }[][];
  };
}

/** The WordPress address: the one saved in the admin, else WP_BASE_URL from Cloudflare. Both are validated. */
export async function wpBase(): Promise<string> {
  let saved = '';
  try {
    saved = (await getSetting('wordpress')).baseUrl ?? '';
  } catch {
    saved = '';
  }
  const ok = (saved && normalizeWpBase(saved)) || normalizeWpBase(env.WP_BASE_URL || '');
  if (!ok) throw new Error('WordPress address is not set (or not a public https address)');
  return ok;
}

async function wpFetch(path: string, timeoutMs = 8000, root?: string): Promise<Response> {
  return fetch(`${root ?? (await wpBase())}/wp-json${path}`, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
    cf: { cacheTtl: 0 },
  } as RequestInit);
}

export async function log(event: string, result: string, ok = true): Promise<void> {
  await sql()`INSERT INTO sync_log (event, result, ok) VALUES (${event.slice(0, 200)}, ${result.slice(0, 200)}, ${ok})`;
  // keep 30 days
  await sql()`DELETE FROM sync_log WHERE at < now() - interval '30 days'`;
}

async function isSameSite(link: string): Promise<boolean> {
  try {
    return new URL(link).origin === new URL(await wpBase()).origin;
  } catch {
    return false;
  }
}

async function upsert(p: WpPost, autoShow: boolean, categoryMap: Record<string, string>): Promise<'new' | 'updated'> {
  const terms = p._embedded?.['wp:term']?.flat() ?? [];
  const category = terms.find((t) => t.taxonomy === 'category')?.name ?? '';
  const mapped = Object.hasOwn(categoryMap, category) ? categoryMap[category] : undefined;
  const topic = typeof mapped === 'string' && mapped ? mapped : category && category !== 'Uncategorized' ? category : 'Notes';
  const media = p._embedded?.['wp:featuredmedia']?.[0];
  const imgRaw = media?.media_details?.sizes?.medium_large?.source_url ?? media?.source_url ?? '';
  const image = imgRaw && /^https:\/\//.test(imgRaw) ? imgRaw : '';
  const words = htmlToText(p.content?.rendered ?? '').split(/\s+/).filter(Boolean).length;
  const url = (await isSameSite(p.link)) ? p.link : `${await wpBase()}/?p=${p.id}`;

  const rows = await sql()`
    INSERT INTO external_posts (wp_id, slug, title, excerpt, url, topic, image_url, read_minutes, published_at, modified_at, show_on_main, removed_at, synced_at)
    VALUES (${p.id}, ${p.slug.slice(0, 200)}, ${htmlToText(p.title?.rendered ?? '', 200)}, ${htmlToText(p.excerpt?.rendered ?? '', 300)},
            ${url}, ${topic.slice(0, 30)}, ${image}, ${Math.max(1, Math.round(words / 220))},
            ${p.date_gmt + 'Z'}, ${p.modified_gmt + 'Z'}, ${autoShow}, NULL, now())
    ON CONFLICT (wp_id) DO UPDATE SET
      slug = EXCLUDED.slug, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, url = EXCLUDED.url,
      topic = EXCLUDED.topic, image_url = EXCLUDED.image_url, read_minutes = EXCLUDED.read_minutes,
      published_at = EXCLUDED.published_at, modified_at = EXCLUDED.modified_at, removed_at = NULL, synced_at = now()
    RETURNING (xmax = 0) AS inserted`;
  return rows[0]?.inserted ? 'new' : 'updated';
}

async function markRemoved(wpId: number): Promise<void> {
  await sql()`UPDATE external_posts SET removed_at = now() WHERE wp_id = ${wpId} AND removed_at IS NULL`;
}

/** Fetch one post by ID (webhook path). */
export async function syncOne(wpId: number, reason: string): Promise<string> {
  const settings = await getSetting('wordpress');
  const res = await wpFetch(`/wp/v2/posts/${wpId}?_embed=wp:featuredmedia,wp:term`);
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    await markRemoved(wpId);
    await log(`${reason}: post ${wpId}`, 'removed (not public on WP)');
    return 'removed';
  }
  if (!res.ok) {
    await log(`${reason}: post ${wpId}`, `fetch failed (${res.status})`, false);
    return 'failed';
  }
  const post = (await res.json()) as WpPost;
  if (post.status !== 'publish') {
    await markRemoved(wpId);
    await log(`${reason}: post ${wpId}`, 'removed (not published)');
    return 'removed';
  }
  const r = await upsert(post, settings.autoShow, settings.categoryMap);
  await log(`${reason}: “${htmlToText(post.title?.rendered ?? '', 60)}”`, r === 'new' ? `new · ${settings.autoShow ? 'shown' : 'hidden'}` : 'updated');
  return r;
}

/** Pull posts modified since the last sync (overlap 10 min for clock skew). */
export async function syncIncremental(reason = 'Scheduled pull'): Promise<void> {
  const settings = await getSetting('wordpress');
  const src = await sql()`SELECT last_sync_at FROM sources WHERE id = 'wordpress'`;
  const last = src[0]?.last_sync_at ? new Date(src[0].last_sync_at as string) : new Date(0);
  const since = new Date(last.getTime() - 10 * 60_000).toISOString().replace(/\.\d+Z$/, '');
  const started = new Date().toISOString();
  let page = 1;
  let created = 0;
  let updated = 0;
  for (;;) {
    const res = await wpFetch(`/wp/v2/posts?status=publish&per_page=50&page=${page}&orderby=modified&order=desc&modified_after=${encodeURIComponent(since)}&_embed=wp:featuredmedia,wp:term`);
    if (res.status === 400 && page > 1) break; // past last page
    if (!res.ok) {
      await log(reason, `failed (${res.status})`, false);
      return;
    }
    const posts = (await res.json()) as WpPost[];
    for (const p of posts) (await upsert(p, settings.autoShow, settings.categoryMap)) === 'new' ? created++ : updated++;
    const totalPages = Number(res.headers.get('X-WP-TotalPages') ?? '1');
    if (page >= totalPages || posts.length === 0 || page >= 20) break;
    page++;
  }
  await sql()`UPDATE sources SET last_sync_at = ${started} WHERE id = 'wordpress'`;
  await log(reason, created + updated === 0 ? '0 changes' : `${created} new · ${updated} updated`);
}

/** Compare all published IDs on WP with ours; mark missing ones removed. */
export async function reconcile(): Promise<void> {
  const ids = new Set<number>();
  let page = 1;
  for (;;) {
    const res = await wpFetch(`/wp/v2/posts?status=publish&per_page=100&page=${page}&_fields=id`, 15000);
    if (res.status === 400 && page > 1) break;
    if (!res.ok) {
      await log('Nightly reconcile', `failed (${res.status})`, false);
      return;
    }
    const rows = (await res.json()) as { id: number }[];
    rows.forEach((r) => ids.add(r.id));
    const totalPages = Number(res.headers.get('X-WP-TotalPages') ?? '1');
    if (page >= totalPages || rows.length === 0 || page >= 100) break;
    page++;
  }
  const ours = await sql()`SELECT wp_id FROM external_posts WHERE removed_at IS NULL`;
  let removed = 0;
  for (const r of ours) {
    if (!ids.has(r.wp_id as number)) {
      await markRemoved(r.wp_id as number);
      removed++;
    }
  }
  await log('Nightly reconcile', removed ? `${removed} removed` : 'in sync');
}

/** Health check with hysteresis. Returns the resulting status. */
export async function healthCheck(): Promise<'up' | 'down'> {
  const t0 = Date.now();
  let ok = false;
  try {
    const res = await wpFetch('/', 5000);
    if (res.ok) {
      const body = (await res.json()) as { name?: unknown };
      ok = typeof body === 'object' && body !== null && 'name' in body;
    }
  } catch {
    ok = false;
  }
  const ms = Date.now() - t0;
  const rows = await sql()`SELECT status, consecutive_fail, consecutive_ok FROM sources WHERE id = 'wordpress'`;
  const cur = rows[0] ?? { status: 'up', consecutive_fail: 0, consecutive_ok: 0 };
  const fails = ok ? 0 : Number(cur.consecutive_fail) + 1;
  const oks = ok ? Number(cur.consecutive_ok) + 1 : 0;
  let status = cur.status as 'up' | 'down';
  if (status === 'up' && fails >= FAILS_TO_DOWN) status = 'down';
  if (status === 'down' && oks >= OKS_TO_UP) status = 'up';
  const changed = status !== cur.status;
  await sql()`
    UPDATE sources SET status = ${status}, consecutive_fail = ${fails}, consecutive_ok = ${oks},
      last_check_at = now(), last_check_ms = ${ms},
      status_since = CASE WHEN ${changed} THEN now() ELSE status_since END
    WHERE id = 'wordpress'`;
  if (!ok) await log('Health check', `failed (${fails} in a row)${changed ? ' · posts hidden' : ''}`, false);
  else if (changed) await log('Health check', 'recovered · posts shown again');
  return status;
}

// ---------------- changing the address ----------------

/** Does this address answer as a WordPress site with the REST API? Never follows a redirect to another host. */
export async function probeWordPress(candidate: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const root = normalizeWpBase(candidate);
  if (!root) return { ok: false, error: 'Use a public https address, like https://hey.example.com' };
  try {
    const res = await fetch(`${root}/wp-json/`, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
      cf: { cacheTtl: 0 },
    } as RequestInit);
    if (res.status >= 300 && res.status < 400) return { ok: false, error: `It redirects to ${res.headers.get('location')?.slice(0, 120) ?? 'another address'}. Use that address instead.` };
    if (!res.ok) return { ok: false, error: `It answered ${res.status}. Check the address and that the REST API is on.` };
    const text = await res.text();
    if (text.length > 2_000_000) return { ok: false, error: 'Unexpected response.' };
    const body = JSON.parse(text) as { name?: unknown; namespaces?: unknown };
    const namespaces = Array.isArray(body.namespaces) ? body.namespaces : [];
    if (!namespaces.includes('wp/v2')) return { ok: false, error: 'That address doesn’t look like WordPress (no wp/v2 REST API).' };
    return { ok: true, name: typeof body.name === 'string' ? body.name.slice(0, 120) : '' };
  } catch {
    return { ok: false, error: 'Couldn’t reach it. Check the address.' };
  }
}

/** After the address changes: forget the old sync position, pull everything again, then drop posts the new site doesn't have. */
export async function resyncAfterAddressChange(): Promise<void> {
  await sql()`UPDATE sources SET last_sync_at = NULL, status = 'up', consecutive_fail = 0, consecutive_ok = 0, status_since = now() WHERE id = 'wordpress'`;
  await log('Address changed', await wpBase());
  await syncIncremental('Full re-sync');
  await reconcile();
}

// ---------------- webhook signature ----------------

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Verify HMAC-SHA256(secret, `${timestamp}.${body}`) with a ±5 minute window. */
export async function verifyWebhook(timestamp: string | null, signature: string | null, body: string): Promise<boolean> {
  const secret = env.WP_WEBHOOK_SECRET;
  if (!secret || secret.length < 32 || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const sig = hexToBytes(signature.replace(/^sha256=/, ''));
  if (!sig) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // crypto.subtle.verify is constant-time.
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${timestamp}.${body}`));
}
