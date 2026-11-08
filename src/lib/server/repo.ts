// SERVER-ONLY data access. Every function uses parameterised SQL.
import { sql } from './db';
import {
  DEFAULT_SETTINGS,
  type Entry,
  type EntryKind,
  type ExternalPost,
  type MediaItem,
  type Page,
  type SettingKey,
  type SettingsMap,
} from '../shared/types';
import type { EntryInput } from '../shared/schemas';
import { readMinutes } from './text';

// ---------------- settings ----------------

const settingsCache = new Map<string, { at: number; value: unknown }>();
const SETTINGS_TTL_MS = 15_000;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
  const hit = settingsCache.get(key);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value as SettingsMap[K];
  const rows = await sql()`SELECT value FROM settings WHERE key = ${key}`;
  const value = rows.length
    ? { ...DEFAULT_SETTINGS[key], ...(rows[0].value as object) }
    : DEFAULT_SETTINGS[key];
  settingsCache.set(key, { at: Date.now(), value });
  return value as SettingsMap[K];
}

export async function getSettings<K extends SettingKey>(keys: K[]): Promise<Pick<SettingsMap, K>> {
  const out = {} as Pick<SettingsMap, K>;
  await Promise.all(keys.map(async (k) => (out[k] = await getSetting(k))));
  return out;
}

export async function putSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void> {
  await sql()`
    INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  settingsCache.delete(key);
}

// ---------------- entries ----------------

const ENTRY_COLS = `id, kind, title, slug, dek, topic, body, cover_media_id, video_url, meta, read_minutes,
  status, is_public, published_at, created_at, updated_at`;

export async function listPublicEntries(kind: EntryKind, opts: { limit?: number; offset?: number; topic?: string } = {}): Promise<Entry[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const topic = opts.topic ?? '';
  const rows = await sql().query(
    `SELECT ${ENTRY_COLS} FROM entries
     WHERE kind = $1 AND status = 'published' AND is_public = true AND published_at <= now()
       AND ($2 = '' OR topic = $2)
     ORDER BY published_at DESC LIMIT $3 OFFSET $4`,
    [kind, topic, limit, offset],
  );
  return rows as Entry[];
}

export async function getPublicEntry(kind: EntryKind, slug: string): Promise<Entry | null> {
  const rows = await sql().query(
    `SELECT ${ENTRY_COLS} FROM entries
     WHERE kind = $1 AND slug = $2 AND status = 'published' AND is_public = true AND published_at <= now()`,
    [kind, slug],
  );
  return (rows[0] as Entry) ?? null;
}

export async function getPublicEntryById(id: string): Promise<Entry | null> {
  const rows = await sql().query(
    `SELECT ${ENTRY_COLS} FROM entries
     WHERE id = $1 AND status = 'published' AND is_public = true AND published_at <= now()`,
    [id],
  );
  return (rows[0] as Entry) ?? null;
}

export async function adminListEntries(kind?: EntryKind): Promise<Omit<Entry, 'body'>[]> {
  const rows = await sql().query(
    `SELECT id, kind, title, slug, dek, topic, cover_media_id, video_url, meta, read_minutes, status, is_public,
            published_at, created_at, updated_at
     FROM entries WHERE ($1::text IS NULL OR kind = $1) ORDER BY updated_at DESC LIMIT 500`,
    [kind ?? null],
  );
  return rows as Omit<Entry, 'body'>[];
}

export async function adminGetEntry(id: string): Promise<Entry | null> {
  const rows = await sql().query(`SELECT ${ENTRY_COLS} FROM entries WHERE id = $1`, [id]);
  return (rows[0] as Entry) ?? null;
}

export async function createEntry(input: EntryInput): Promise<Entry> {
  const publishedAt = input.status === 'published' ? input.published_at ?? new Date().toISOString() : input.published_at;
  const rows = await sql().query(
    `INSERT INTO entries (kind, title, slug, dek, topic, body, cover_media_id, video_url, meta, read_minutes, status, is_public, published_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12,$13)
     RETURNING ${ENTRY_COLS}`,
    [
      input.kind, input.title, input.slug, input.dek, input.topic, JSON.stringify(input.body),
      input.cover_media_id, input.video_url, JSON.stringify(input.meta), readMinutes(input.body),
      input.status, input.is_public, publishedAt,
    ],
  );
  return rows[0] as Entry;
}

export async function updateEntry(id: string, input: EntryInput): Promise<Entry | null> {
  const publishedAt = input.status === 'published' ? input.published_at ?? new Date().toISOString() : input.published_at;
  const rows = await sql().query(
    `UPDATE entries SET kind=$2, title=$3, slug=$4, dek=$5, topic=$6, body=$7::jsonb, cover_media_id=$8, video_url=$9,
       meta=$10::jsonb, read_minutes=$11, status=$12, is_public=$13, published_at=$14, updated_at=now()
     WHERE id = $1 RETURNING ${ENTRY_COLS}`,
    [
      id, input.kind, input.title, input.slug, input.dek, input.topic, JSON.stringify(input.body),
      input.cover_media_id, input.video_url, JSON.stringify(input.meta), readMinutes(input.body),
      input.status, input.is_public, publishedAt,
    ],
  );
  return (rows[0] as Entry) ?? null;
}

export async function setEntryVisibility(id: string, isPublic: boolean): Promise<void> {
  await sql()`UPDATE entries SET is_public = ${isPublic}, updated_at = now() WHERE id = ${id}`;
}

export async function deleteEntry(id: string): Promise<void> {
  await sql()`DELETE FROM entries WHERE id = ${id}`;
}

// ---------------- pages ----------------

export async function getPage(slug: Page['slug']): Promise<Page | null> {
  const rows = await sql()`SELECT slug, title, body, noindex, updated_at FROM pages WHERE slug = ${slug}`;
  return (rows[0] as Page) ?? null;
}

let privacyCache: { at: number; has: boolean } | null = null;
/** Whether a Privacy page with content exists (cached a minute per isolate; for the footer link). */
export async function hasPrivacyPage(): Promise<boolean> {
  if (privacyCache && Date.now() - privacyCache.at < 60_000) return privacyCache.has;
  const rows = await sql()`SELECT jsonb_array_length(COALESCE(body->'content', '[]'::jsonb)) > 0 AS has FROM pages WHERE slug = 'privacy'`;
  privacyCache = { at: Date.now(), has: rows[0]?.has === true };
  return privacyCache.has;
}

export async function putPage(slug: Page['slug'], p: { title: string; body: unknown; noindex: boolean }): Promise<Page> {
  const rows = await sql()`
    INSERT INTO pages (slug, title, body, noindex, updated_at)
    VALUES (${slug}, ${p.title}, ${JSON.stringify(p.body)}::jsonb, ${p.noindex}, now())
    ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, noindex = EXCLUDED.noindex, updated_at = now()
    RETURNING slug, title, body, noindex, updated_at`;
  if (slug === 'privacy') privacyCache = null;
  return rows[0] as Page;
}

// ---------------- media ----------------

export async function getMedia(id: string): Promise<MediaItem | null> {
  const rows = await sql()`SELECT * FROM media WHERE id = ${id}`;
  return (rows[0] as MediaItem) ?? null;
}

export async function listMedia(limit = 200): Promise<MediaItem[]> {
  const rows = await sql()`SELECT * FROM media ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`;
  return rows as MediaItem[];
}

export async function insertMedia(m: Omit<MediaItem, 'id' | 'created_at'>): Promise<MediaItem> {
  const rows = await sql()`
    INSERT INTO media (provider, object_key, embed_id, mime, bytes, width, height, alt, filename)
    VALUES (${m.provider}, ${m.object_key}, ${m.embed_id}, ${m.mime}, ${m.bytes}, ${m.width}, ${m.height}, ${m.alt}, ${m.filename})
    RETURNING *`;
  return rows[0] as MediaItem;
}

export async function setWatermarkCopy(id: string, key: string, mime: string, sig: string): Promise<void> {
  await sql()`UPDATE media SET wm_key = ${key}, wm_mime = ${mime}, wm_sig = ${sig} WHERE id = ${id}`;
}

/** Photos whose watermarked copy is missing or made with other settings. */
export async function watermarkStatus(sig: string): Promise<{ total: number; pending: { id: string; mime: string }[] }> {
  const rows = await sql()`
    SELECT id, mime, (wm_key IS NOT NULL AND wm_sig = ${sig}) AS done FROM media
    WHERE provider IN ('r2','nas','b2') AND mime IN ('image/jpeg','image/png','image/webp','image/avif')
    ORDER BY created_at DESC`;
  return { total: rows.length, pending: rows.filter((r) => !r.done).map((r) => ({ id: r.id as string, mime: r.mime as string })) };
}

export async function deleteMediaRow(id: string): Promise<void> {
  await sql()`DELETE FROM media WHERE id = ${id}`;
}

// ---------------- external (WordPress) posts ----------------

export async function listVisibleExternalPosts(opts: { limit?: number; topic?: string } = {}): Promise<ExternalPost[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const topic = opts.topic ?? '';
  const rows = await sql().query(
    `SELECT * FROM external_posts
     WHERE show_on_main = true AND removed_at IS NULL AND ($1 = '' OR topic = $1)
     ORDER BY published_at DESC LIMIT $2`,
    [topic, limit],
  );
  return rows as ExternalPost[];
}

export async function adminListExternalPosts(): Promise<ExternalPost[]> {
  const rows = await sql()`SELECT * FROM external_posts ORDER BY published_at DESC LIMIT 500`;
  return rows as ExternalPost[];
}

export async function setExternalVisibility(wpId: number, show: boolean): Promise<void> {
  await sql()`UPDATE external_posts SET show_on_main = ${show} WHERE wp_id = ${wpId}`;
}
