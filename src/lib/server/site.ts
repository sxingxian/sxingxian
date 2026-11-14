// SERVER-ONLY. Data assembly for public pages.
import { sql } from './db';
import { getSettings, listPublicEntries, listVisibleExternalPosts, queryEntries, TOPICS_COL } from './repo';
import type { Entry, SectionsSetting } from '../shared/types';
import { featuredIds, KIND_PATH, MAX_FEATURED, SECTION_LABELS } from '../shared/types';

export interface FeedItem {
  key: string;
  source: 'native' | 'wordpress';
  title: string;
  dek: string;
  topics: string[];
  url: string;
  external: boolean;
  date: string;
  readMinutes: number;
  image: { kind: 'media'; id: string } | { kind: 'url'; url: string } | null;
}

// ---- WordPress visibility (cached briefly per isolate) ----
let wpCache: { at: number; visible: boolean } | null = null;

export async function isWordPressVisible(): Promise<boolean> {
  if (wpCache && Date.now() - wpCache.at < 20_000) return wpCache.visible;
  const [{ wordpress }, rows] = await Promise.all([getSettings(['wordpress']), sql()`SELECT status FROM sources WHERE id = 'wordpress'`]);
  const down = rows[0]?.status === 'down';
  const visible = !(down && wordpress.hideWhenDown);
  wpCache = { at: Date.now(), visible };
  return visible;
}

export function entryToFeed(e: Entry): FeedItem {
  return {
    key: `n:${e.id}`,
    source: 'native',
    title: e.title,
    dek: e.dek,
    topics: e.topics ?? (e.topic ? [e.topic] : []),
    url: `${KIND_PATH[e.kind]}/${e.slug}`,
    external: false,
    date: String(e.published_at ?? e.created_at),
    readMinutes: e.read_minutes,
    image: e.cover_media_id ? { kind: 'media', id: e.cover_media_id } : null,
  };
}

/** Stories feed: native posts + visible WordPress posts, newest first. */
export async function getFeed(opts: { topic?: string; limit?: number; excludeIds?: string[] } = {}): Promise<FeedItem[]> {
  const limit = opts.limit ?? 12;
  const exclude = new Set(opts.excludeIds ?? []);
  const [native, wpVisible] = await Promise.all([
    listPublicEntries('post', { topic: opts.topic, limit: limit + exclude.size }),
    isWordPressVisible(),
  ]);
  const external = wpVisible ? await listVisibleExternalPosts({ topic: opts.topic, limit }) : [];
  const items: FeedItem[] = [
    ...native.filter((e) => !exclude.has(e.id)).map(entryToFeed),
    ...external.map<FeedItem>((p) => ({
      key: `w:${p.wp_id}`,
      source: 'wordpress',
      title: p.title,
      dek: p.excerpt,
      topics: p.topic ? [p.topic] : [],
      url: p.url,
      external: true,
      date: String(p.published_at),
      readMinutes: p.read_minutes,
      image: p.image_url ? { kind: 'url', url: p.image_url } : null,
    })),
  ];
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return items.slice(0, limit);
}

/**
 * Featured stories for the home page carousel: the chosen ones that are still public, newest first or in
 * the owner's order. None chosen (or none still public) = the latest story.
 */
export async function getFeaturedList(): Promise<Entry[]> {
  const { featured } = await getSettings(['featured']);
  const ids = featuredIds(featured);
  if (ids.length) {
    const rows = (await queryEntries(
      `SELECT ENTRY_COLS FROM entries
       WHERE id = ANY($1::uuid[]) AND kind = 'post' AND status = 'published' AND is_public = true AND published_at <= now()
       ORDER BY published_at DESC`,
      [ids],
    )) as Entry[];
    if (featured.order === 'custom') rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    if (rows.length) return rows.slice(0, MAX_FEATURED);
  }
  return listPublicEntries('post', { limit: 1 });
}

// ---------------- stories archive: one list of native + WordPress posts, by year and page ----------------

export const ARCHIVE_PAGE_SIZE = 20;
// Years follow the date shown on the site (Singapore time).
const YEAR_OF = `extract(year from date AT TIME ZONE 'Asia/Singapore')::int`;

function feedUnion(): string {
  return `SELECT 'n' AS src, id::text AS ref, title, dek, ${TOPICS_COL}, published_at AS date, read_minutes,
                 cover_media_id::text AS media_id, ''::text AS image_url, slug, ''::text AS url
          FROM entries
          WHERE kind = 'post' AND status = 'published' AND is_public = true AND published_at <= now()
            AND ($1 = '' OR $1 = ANY(topics) OR topic = $1)
          UNION ALL
          SELECT 'w', wp_id::text, title, excerpt, CASE WHEN topic <> '' THEN ARRAY[topic] ELSE '{}'::text[] END,
                 published_at, read_minutes, NULL, image_url, slug, url
          FROM external_posts
          WHERE $2::boolean AND show_on_main = true AND removed_at IS NULL AND ($1 = '' OR topic = $1)`;
}

interface FeedRow {
  src: 'n' | 'w';
  ref: string;
  title: string;
  dek: string;
  topics: string[];
  date: string;
  read_minutes: number;
  media_id: string | null;
  image_url: string;
  slug: string;
  url: string;
}

function rowToFeed(r: FeedRow): FeedItem {
  const native = r.src === 'n';
  return {
    key: `${r.src}:${r.ref}`,
    source: native ? 'native' : 'wordpress',
    title: r.title,
    dek: r.dek,
    topics: r.topics ?? [],
    url: native ? `/story/${r.slug}` : r.url,
    external: !native,
    date: String(r.date),
    readMinutes: r.read_minutes,
    image: native ? (r.media_id ? { kind: 'media', id: r.media_id } : null) : r.image_url ? { kind: 'url', url: r.image_url } : null,
  };
}

/** Years that have stories (newest first) with counts, for the archive sidebar. */
export async function feedYears(opts: { topic?: string } = {}): Promise<{ year: number; count: number }[]> {
  const wp = await isWordPressVisible();
  const rows = await queryEntries(
    `SELECT ${YEAR_OF} AS year, count(*)::int AS count FROM (${feedUnion()}) f GROUP BY 1 ORDER BY 1 DESC`,
    [opts.topic ?? '', wp],
  );
  return rows as { year: number; count: number }[];
}

/** One page of the archive: stories newest first, optionally one year only. */
export async function feedPage(opts: { topic?: string; year?: number | null; page?: number; perPage?: number } = {}): Promise<{ items: FeedItem[]; total: number; page: number; pages: number }> {
  const per = Math.min(Math.max(opts.perPage ?? ARCHIVE_PAGE_SIZE, 1), 50);
  const wp = await isWordPressVisible();
  const year = opts.year ?? null;
  const countRows = await queryEntries(
    `SELECT count(*)::int AS total FROM (${feedUnion()}) f WHERE ($3::int IS NULL OR ${YEAR_OF} = $3)`,
    [opts.topic ?? '', wp, year],
  );
  const total = (countRows[0] as { total: number } | undefined)?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(Math.max(Math.trunc(opts.page ?? 1), 1), pages);
  const rows = await queryEntries(
    `SELECT * FROM (${feedUnion()}) f WHERE ($3::int IS NULL OR ${YEAR_OF} = $3)
     ORDER BY date DESC, ref DESC LIMIT $4 OFFSET $5`,
    [opts.topic ?? '', wp, year, per, (page - 1) * per],
  );
  return { items: (rows as FeedRow[]).map(rowToFeed), total, page, pages };
}

// ---------------- most read ----------------

const MOST_READ_DAYS = 30;

/**
 * The most-read stories over the last 30 days: reads of stories here plus clicks through to WordPress
 * posts, both still public. Empty until something has been read, or before migration 0009 has run.
 */
export async function mostRead(limit = 5): Promise<FeedItem[]> {
  const wp = await isWordPressVisible();
  try {
    const rows = await queryEntries(
      `WITH v AS (
         SELECT item, sum(n)::int AS reads FROM item_views
         WHERE day > (now() AT TIME ZONE 'Asia/Singapore')::date - $3::int GROUP BY item
       )
       SELECT f.*, v.reads FROM v JOIN (${feedUnion()}) f ON v.item = f.src || ':' || f.ref
       ORDER BY v.reads DESC, f.date DESC LIMIT $4`,
      ['', wp, MOST_READ_DAYS, Math.min(Math.max(limit, 1), 10)],
    );
    return (rows as FeedRow[]).map(rowToFeed);
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return [];
    throw e;
  }
}

// Read counts on story pages: cached briefly per isolate so a busy story isn't one query per view.
const READS_TTL_MS = 60_000;
const readsCache = new Map<string, { at: number; n: number }>();

/**
 * All-time reads of one story here: the daily totals still kept plus the older days rolled up by the
 * daily job. Before migration 0016 runs, only the daily totals; before 0009, zero.
 */
export async function storyReads(entryId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/.test(entryId)) return 0;
  const item = `n:${entryId}`;
  const hit = readsCache.get(item);
  if (hit && Date.now() - hit.at < READS_TTL_MS) return hit.n;
  const daily = `SELECT coalesce(sum(n), 0)::bigint FROM item_views WHERE item = $1`;
  let n = 0;
  try {
    const rows = await sql().query(`SELECT ((${daily}) + coalesce((SELECT n FROM item_reads_total WHERE item = $1), 0))::text AS n`, [item]);
    n = Number((rows as { n: string }[])[0]?.n ?? 0);
  } catch (e) {
    if ((e as { code?: string })?.code !== '42P01') throw e;
    try {
      const rows = await sql().query(`SELECT (${daily})::text AS n`, [item]);
      n = Number((rows as { n: string }[])[0]?.n ?? 0);
    } catch (e2) {
      if ((e2 as { code?: string })?.code !== '42P01') throw e2;
    }
  }
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (readsCache.size > 500) readsCache.clear();
  readsCache.set(item, { at: Date.now(), n });
  return n;
}

/** Count one read. Only public stories and visible WordPress posts are counted; anything else is ignored. */
export async function recordView(item: string): Promise<void> {
  const [kind, ref] = [item.slice(0, 1), item.slice(2)];
  const exists =
    kind === 'n'
      ? `SELECT 1 FROM entries WHERE id = $2::uuid AND kind = 'post' AND status = 'published' AND is_public = true AND published_at <= now()`
      : `SELECT 1 FROM external_posts WHERE wp_id = $2::bigint AND show_on_main = true AND removed_at IS NULL`;
  await sql().query(
    `INSERT INTO item_views (item, day, n)
     SELECT $1, (now() AT TIME ZONE 'Asia/Singapore')::date, 1 WHERE EXISTS (${exists})
     ON CONFLICT (item, day) DO UPDATE SET n = item_views.n + 1`,
    [item, ref],
  );
}

export interface NavItem {
  href: string;
  label: string;
}

export function navItems(sections: SectionsSetting): NavItem[] {
  const items: NavItem[] = [{ href: '/', label: 'Stories' }];
  const map: [keyof SectionsSetting, string][] = [
    ['work', '/work'],
    ['photos', '/photos'],
    ['film', '/film'],
    ['cv', '/cv'],
    ['about', '/about'],
  ];
  for (const [key, href] of map) if (sections[key]) items.push({ href, label: SECTION_LABELS[key] });
  return items;
}
