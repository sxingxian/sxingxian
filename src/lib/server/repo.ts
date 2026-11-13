// SERVER-ONLY data access. Every function uses parameterised SQL.
import { sql } from './db';
import {
  cleanTopics,
  DEFAULT_SETTINGS,
  type Entry,
  type EntryEdits,
  type EntryKind,
  type ExternalPost,
  type MediaItem,
  type Page,
  type SettingKey,
  type SettingsMap,
} from '../shared/types';
import type { EntryContent } from '../shared/schemas';
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

// topics falls back to [topic] for a row written by the previous release after the migration ran.
export const TOPICS_COL = `CASE WHEN cardinality(topics) = 0 AND topic <> '' THEN ARRAY[topic] ELSE topics END AS topics`;
const ENTRY_COLS = `id, kind, title, slug, dek, topic, ${TOPICS_COL}, body, cover_media_id, video_url, meta, read_minutes,
  status, is_public, published_at, created_at, updated_at`;

// Code goes live a few minutes before migrations run. Until 0007 adds the topics column, reads fall back
// to the old single topic so public pages keep working. Writes simply fail and the admin's autosave
// retries until the column exists.
const LEGACY_TOPICS_COL = `CASE WHEN topic <> '' THEN ARRAY[topic] ELSE '{}'::text[] END AS topics`;
function isMissingTopics(e: unknown): boolean {
  return (e as { code?: string })?.code === '42703' && /topics/.test(String((e as Error)?.message ?? ''));
}
async function readEntries(text: string, params: unknown[]): Promise<unknown[]> {
  try {
    return await sql().query(text, params);
  } catch (e) {
    if (!isMissingTopics(e)) throw e;
    return sql().query(text.replaceAll(TOPICS_COL, LEGACY_TOPICS_COL).replace('$2 = ANY(topics) OR ', ''), params);
  }
}

/**
 * Public-read helper for other server modules: runs a query that may use TOPICS_COL / `ANY(topics)`
 * (and the literal ENTRY_COLS) with the same pre-0007 fallback as the reads above.
 */
export async function queryEntries(text: string, params: unknown[]): Promise<unknown[]> {
  const q = text.replaceAll('ENTRY_COLS', ENTRY_COLS);
  try {
    return await sql().query(q, params);
  } catch (e) {
    if (!isMissingTopics(e)) throw e;
    return sql().query(q.replaceAll(TOPICS_COL, LEGACY_TOPICS_COL).replaceAll('$1 = ANY(topics) OR ', ''), params);
  }
}

/** Topics to store for an entry: cleaned topics[], or the legacy single topic from older clients. */
function inputTopics(input: EntryContent): string[] {
  return cleanTopics(input.topics ?? (input.topic ? [input.topic] : []));
}

export async function listPublicEntries(kind: EntryKind, opts: { limit?: number; offset?: number; topic?: string } = {}): Promise<Entry[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const topic = opts.topic ?? '';
  const rows = await readEntries(
    `SELECT ${ENTRY_COLS} FROM entries
     WHERE kind = $1 AND status = 'published' AND is_public = true AND published_at <= now()
       AND ($2 = '' OR $2 = ANY(topics) OR topic = $2)
     ORDER BY published_at DESC LIMIT $3 OFFSET $4`,
    [kind, topic, limit, offset],
  );
  return rows as Entry[];
}

/** Every live entry, light fields only: for sitemap.xml and llms.txt. */
export async function listPublicIndex(): Promise<Pick<Entry, 'kind' | 'slug' | 'title' | 'dek' | 'cover_media_id' | 'published_at' | 'updated_at'>[]> {
  const rows = await sql()`
    SELECT kind, slug, title, dek, cover_media_id, published_at, updated_at FROM entries
    WHERE status = 'published' AND is_public = true AND published_at <= now()
    ORDER BY published_at DESC LIMIT 5000`;
  return rows as Pick<Entry, 'kind' | 'slug' | 'title' | 'dek' | 'cover_media_id' | 'published_at' | 'updated_at'>[];
}

export async function getPublicEntry(kind: EntryKind, slug: string): Promise<Entry | null> {
  const rows = await readEntries(
    `SELECT ${ENTRY_COLS} FROM entries
     WHERE kind = $1 AND slug = $2 AND status = 'published' AND is_public = true AND published_at <= now()`,
    [kind, slug],
  );
  return (rows[0] as Entry) ?? null;
}

export async function getPublicEntryById(id: string): Promise<Entry | null> {
  const rows = await readEntries(
    `SELECT ${ENTRY_COLS} FROM entries
     WHERE id = $1 AND status = 'published' AND is_public = true AND published_at <= now()`,
    [id],
  );
  return (rows[0] as Entry) ?? null;
}

// entry_edits (migration 0010) may not exist yet for a few minutes after a release: code goes live first.
function isMissingEdits(e: unknown): boolean {
  return (e as { code?: string })?.code === '42P01' && /entry_edits/.test(String((e as Error)?.message ?? ''));
}

export async function adminListEntries(kind?: EntryKind): Promise<Omit<Entry, 'body'>[]> {
  const q = (edits: boolean) => `SELECT id, kind, title, slug, dek, topic, ${TOPICS_COL}, cover_media_id, video_url, meta, read_minutes, status, is_public,
            published_at, created_at, updated_at,
            ${edits ? 'EXISTS (SELECT 1 FROM entry_edits x WHERE x.entry_id = entries.id)' : 'false'} AS has_edits
     FROM entries WHERE ($1::text IS NULL OR kind = $1) ORDER BY updated_at DESC LIMIT 500`;
  try {
    return (await readEntries(q(true), [kind ?? null])) as Omit<Entry, 'body'>[];
  } catch (e) {
    if (!isMissingEdits(e)) throw e;
    return (await readEntries(q(false), [kind ?? null])) as Omit<Entry, 'body'>[];
  }
}

export type EntryStateFilter = 'all' | 'draft' | 'scheduled' | 'published';
export interface EntryPage {
  entries: Omit<Entry, 'body'>[];
  /** Rows matching the search and state filter (what the pager counts). */
  total: number;
  /** Every entry of this kind by state, ignoring the search (the numbers on the filter). */
  counts: Record<EntryStateFilter, number>;
}

// The same three states as lib/shared/state.ts entryState(), in SQL.
const LIVE = `(status = 'published' AND is_public)`;
const STATE_SQL: Record<EntryStateFilter, string> = {
  all: 'true',
  draft: `NOT ${LIVE}`,
  scheduled: `${LIVE} AND published_at > now()`,
  published: `${LIVE} AND (published_at IS NULL OR published_at <= now())`,
};

/** One page of the admin list, newest edit first. `like` is a ready ILIKE pattern (or null for no search). */
export async function adminPageEntries(opts: { kind: EntryKind; state: EntryStateFilter; like: string | null; size: number; offset: number }): Promise<EntryPage> {
  const where = `kind = $1 AND (${STATE_SQL[opts.state]})
    AND ($2::text IS NULL OR title ILIKE $2 OR topic ILIKE $2 OR EXISTS (SELECT 1 FROM unnest(topics) t WHERE t ILIKE $2))`;
  const cols = (edits: boolean) => `id, kind, title, slug, dek, topic, ${TOPICS_COL}, cover_media_id, video_url, meta, read_minutes, status, is_public,
            published_at, created_at, updated_at,
            ${edits ? 'EXISTS (SELECT 1 FROM entry_edits x WHERE x.entry_id = entries.id)' : 'false'} AS has_edits`;
  const list = (edits: boolean) => sql().query(
    `SELECT ${cols(edits)} FROM entries WHERE ${where} ORDER BY updated_at DESC, id LIMIT $3 OFFSET $4`,
    [opts.kind, opts.like, opts.size, opts.offset],
  );
  const [rows, matched, counts] = await Promise.all([
    list(true).catch((e) => { if (isMissingEdits(e)) return list(false); throw e; }),
    sql().query(`SELECT count(*)::int AS n FROM entries WHERE ${where}`, [opts.kind, opts.like]),
    sql().query(
      `SELECT count(*)::int AS all, count(*) FILTER (WHERE ${STATE_SQL.draft})::int AS draft,
              count(*) FILTER (WHERE ${STATE_SQL.scheduled})::int AS scheduled, count(*) FILTER (WHERE ${STATE_SQL.published})::int AS published
         FROM entries WHERE kind = $1`,
      [opts.kind],
    ),
  ]);
  const c = (counts[0] ?? {}) as Record<string, number>;
  return {
    entries: rows as Omit<Entry, 'body'>[],
    total: Number((matched[0] as { n?: number })?.n ?? 0),
    counts: { all: Number(c.all ?? 0), draft: Number(c.draft ?? 0), scheduled: Number(c.scheduled ?? 0), published: Number(c.published ?? 0) },
  };
}

export async function adminGetEntry(id: string): Promise<Entry | null> {
  const rows = await readEntries(`SELECT ${ENTRY_COLS} FROM entries WHERE id = $1`, [id]);
  return (rows[0] as Entry) ?? null;
}

/** The fields an editor save writes, cleaned (topics, legacy topic, reading time). */
export function contentFields(input: EntryContent): EntryEdits {
  const topics = inputTopics(input);
  return {
    title: input.title, slug: input.slug, dek: input.dek, topic: topics[0] ?? '', topics, body: input.body,
    cover_media_id: input.cover_media_id, video_url: input.video_url, meta: input.meta, read_minutes: readMinutes(input.body),
  };
}

/** A new entry always starts as a draft. */
export async function createEntry(input: EntryContent): Promise<Entry> {
  const c = contentFields(input);
  const rows = await sql().query(
    `INSERT INTO entries (kind, title, slug, dek, topic, topics, body, cover_media_id, video_url, meta, read_minutes, status, is_public, published_at)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7::jsonb,$8,$9,$10::jsonb,$11,'draft',false,NULL)
     RETURNING ${ENTRY_COLS}`,
    [input.kind, c.title, c.slug, c.dek, c.topic, c.topics, JSON.stringify(c.body), c.cover_media_id, c.video_url, JSON.stringify(c.meta), c.read_minutes],
  );
  return rows[0] as Entry;
}

/** Content straight into the entry (drafts and scheduled entries: nobody sees them yet). */
export async function updateEntryContent(id: string, c: EntryEdits): Promise<Entry | null> {
  const rows = await sql().query(
    `UPDATE entries SET title=$2, slug=$3, dek=$4, topic=$5, topics=$6::text[], body=$7::jsonb, cover_media_id=$8, video_url=$9,
       meta=$10::jsonb, read_minutes=$11, updated_at=now()
     WHERE id = $1 RETURNING ${ENTRY_COLS}`,
    [id, c.title, c.slug, c.dek, c.topic, c.topics, JSON.stringify(c.body), c.cover_media_id, c.video_url, JSON.stringify(c.meta), c.read_minutes],
  );
  return (rows[0] as Entry) ?? null;
}

export async function slugTaken(kind: EntryKind, slug: string, exceptId: string): Promise<boolean> {
  const rows = await sql()`SELECT 1 FROM entries WHERE kind = ${kind} AND slug = ${slug} AND id <> ${exceptId} LIMIT 1`;
  return rows.length > 0;
}

export async function getEntryEdits(id: string): Promise<EntryEdits | null> {
  try {
    const rows = await sql()`SELECT data FROM entry_edits WHERE entry_id = ${id}`;
    return (rows[0]?.data as EntryEdits) ?? null;
  } catch (e) {
    if (isMissingEdits(e)) return null;
    throw e;
  }
}

/** Keep edits to a live entry private. false = the table isn't there yet (the caller saves straight to the entry). */
export async function putEntryEdits(id: string, c: EntryEdits): Promise<boolean> {
  try {
    await sql()`INSERT INTO entry_edits (entry_id, data, updated_at) VALUES (${id}, ${JSON.stringify(c)}::jsonb, now())
      ON CONFLICT (entry_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    await sql()`UPDATE entries SET updated_at = now() WHERE id = ${id}`;
    return true;
  } catch (e) {
    if (isMissingEdits(e)) return false;
    throw e;
  }
}

export async function deleteEntryEdits(id: string): Promise<void> {
  try {
    await sql()`DELETE FROM entry_edits WHERE entry_id = ${id}`;
  } catch (e) {
    if (!isMissingEdits(e)) throw e;
  }
}

/**
 * Move private edits into the entry and drop them, in one statement (a slug clash fails the whole thing,
 * leaving the edits in place). Returns whether there were edits to apply.
 */
export async function applyEntryEdits(id: string): Promise<boolean> {
  try {
    const rows = await sql().query(
      `WITH d AS (DELETE FROM entry_edits WHERE entry_id = $1 RETURNING data)
       UPDATE entries e SET
         title = d.data->>'title', slug = d.data->>'slug', dek = d.data->>'dek', topic = d.data->>'topic',
         topics = ARRAY(SELECT jsonb_array_elements_text(d.data->'topics')), body = d.data->'body',
         cover_media_id = NULLIF(d.data->>'cover_media_id', '')::uuid, video_url = d.data->>'video_url',
         meta = d.data->'meta', read_minutes = (d.data->>'read_minutes')::int, updated_at = now()
       FROM d WHERE e.id = $1 RETURNING e.id`,
      [id],
    );
    return rows.length > 0;
  } catch (e) {
    if (isMissingEdits(e)) return false;
    throw e;
  }
}

/** Set the publishing state. Publishing or scheduling also makes the entry public (the old visibility switch). */
export async function setEntryState(id: string, status: 'draft' | 'published', publishedAt: string | null): Promise<void> {
  if (status === 'published') {
    await sql()`UPDATE entries SET status = 'published', is_public = true, published_at = ${publishedAt}, updated_at = now() WHERE id = ${id}`;
  } else {
    await sql()`UPDATE entries SET status = 'draft', updated_at = now() WHERE id = ${id}`;
  }
}

export async function setEntryDate(id: string, publishedAt: string): Promise<void> {
  await sql()`UPDATE entries SET published_at = ${publishedAt}, updated_at = now() WHERE id = ${id}`;
}

export async function deleteEntry(id: string): Promise<void> {
  await sql()`DELETE FROM entries WHERE id = ${id}`;
}

// ---------------- pages ----------------

export async function getPage(slug: Page['slug']): Promise<Page | null> {
  const rows = await sql()`SELECT slug, title, body, noindex, updated_at FROM pages WHERE slug = ${slug}`;
  return (rows[0] as Page) ?? null;
}

let writtenCache: { at: number; slugs: Set<string> } | null = null;
/** The standalone pages that have content (cached a minute per isolate; for the footer links). */
export async function writtenPages(): Promise<Set<string>> {
  if (writtenCache && Date.now() - writtenCache.at < 60_000) return writtenCache.slugs;
  const rows = await sql()`SELECT slug FROM pages WHERE CASE WHEN jsonb_typeof(body->'content') = 'array' THEN jsonb_array_length(body->'content') > 0 ELSE false END`;
  writtenCache = { at: Date.now(), slugs: new Set(rows.map((r) => String(r.slug))) };
  return writtenCache.slugs;
}


export async function putPage(slug: Page['slug'], p: { title: string; body: unknown; noindex: boolean }): Promise<Page> {
  const rows = await sql()`
    INSERT INTO pages (slug, title, body, noindex, updated_at)
    VALUES (${slug}, ${p.title}, ${JSON.stringify(p.body)}::jsonb, ${p.noindex}, now())
    ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, noindex = EXCLUDED.noindex, updated_at = now()
    RETURNING slug, title, body, noindex, updated_at`;
  writtenCache = null;
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

export type MediaKindFilter = 'all' | 'image' | 'video' | 'file';
/** One page of the media library, newest first. Photos are image/*, files are the allowed documents, video is the rest. */
export async function pageMedia(opts: { kind: MediaKindFilter; docMimes: string[]; size: number; offset: number }): Promise<{ media: MediaItem[]; total: number; counts: Record<MediaKindFilter, number> }> {
  const KIND: Record<MediaKindFilter, string> = {
    all: 'true',
    image: `mime LIKE 'image/%'`,
    file: `mime = ANY($1::text[])`,
    video: `mime NOT LIKE 'image/%' AND NOT (mime = ANY($1::text[]))`,
  };
  const [rows, counts] = await Promise.all([
    // $1 is typed here even when this filter doesn't use it (Postgres must know every parameter's type).
    sql().query(`SELECT * FROM media WHERE $1::text[] IS NOT NULL AND (${KIND[opts.kind]}) ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`, [opts.docMimes, opts.size, opts.offset]),
    sql().query(
      `SELECT count(*)::int AS all, count(*) FILTER (WHERE ${KIND.image})::int AS image,
              count(*) FILTER (WHERE ${KIND.file})::int AS file, count(*) FILTER (WHERE ${KIND.video})::int AS video FROM media`,
      [opts.docMimes],
    ),
  ]);
  const c = (counts[0] ?? {}) as Record<string, number>;
  const all = { all: Number(c.all ?? 0), image: Number(c.image ?? 0), file: Number(c.file ?? 0), video: Number(c.video ?? 0) };
  return { media: rows as MediaItem[], total: all[opts.kind], counts: all };
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

/** One page of the synced WordPress posts, newest first. */
export async function pageExternalPosts(size: number, offset: number): Promise<{ posts: ExternalPost[]; total: number }> {
  const [rows, n] = await Promise.all([
    sql()`SELECT * FROM external_posts ORDER BY published_at DESC, wp_id DESC LIMIT ${size} OFFSET ${offset}`,
    sql()`SELECT count(*)::int AS n FROM external_posts`,
  ]);
  return { posts: rows as ExternalPost[], total: Number(n[0]?.n ?? 0) };
}

export async function setExternalVisibility(wpId: number, show: boolean): Promise<void> {
  await sql()`UPDATE external_posts SET show_on_main = ${show} WHERE wp_id = ${wpId}`;
}

// ---------------- watermark logo (single row) ----------------

function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getWatermarkLogo(): Promise<{ data: Uint8Array<ArrayBuffer>; sha256: string; width: number; height: number } | null> {
  const rows = await sql()`SELECT translate(encode(data, 'base64'), E'\n', '') AS b64, sha256, width, height FROM watermark_logo WHERE id = 1`;
  if (!rows.length) return null;
  const r = rows[0];
  return { data: fromB64(r.b64 as string), sha256: r.sha256 as string, width: r.width as number, height: r.height as number };
}

export async function putWatermarkLogo(data: Uint8Array, sha256: string, width: number, height: number): Promise<void> {
  await sql()`
    INSERT INTO watermark_logo (id, mime, data, sha256, width, height, updated_at)
    VALUES (1, 'image/png', decode(${toB64(data)}, 'base64'), ${sha256}, ${width}, ${height}, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, sha256 = EXCLUDED.sha256, width = EXCLUDED.width,
      height = EXCLUDED.height, updated_at = now()`;
}

export async function deleteWatermarkLogo(): Promise<void> {
  await sql()`DELETE FROM watermark_logo WHERE id = 1`;
}
