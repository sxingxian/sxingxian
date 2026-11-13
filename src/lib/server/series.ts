// SERVER-ONLY. Series: stories grouped into numbered parts. Parameterised SQL only.
// The tables arrive with migration 0009. Code goes live a few minutes earlier, so public reads
// treat a missing table as "no series yet" instead of failing the page.
import { sql } from './db';
import type { Series, SeriesAdminRow } from '../shared/types';
import type { SeriesInput } from '../shared/schemas';

const SERIES_COLS = 'id, slug, title, description, planned_parts, is_public, created_at, updated_at';
// The visibility rule for a story, used everywhere a part is shown publicly.
const PUBLIC_POST = `e.kind = 'post' AND e.status = 'published' AND e.is_public = true AND e.published_at <= now()`;

// The next scheduled part of series `s`: number and time only.
const NEXT_PART = `LEFT JOIN LATERAL (
    SELECT sp2.part, e2.published_at AS at
    FROM series_parts sp2 JOIN entries e2 ON e2.id = sp2.entry_id
    WHERE sp2.series_id = s.id AND e2.kind = 'post' AND e2.status = 'published' AND e2.is_public = true AND e2.published_at > now()
    ORDER BY e2.published_at, sp2.part LIMIT 1
  ) nx ON true`;
const MAX_COVERS = 6;

function isMissingTable(e: unknown): boolean {
  return (e as { code?: string })?.code === '42P01';
}
async function nextPart(seriesId: string): Promise<NextPart | null> {
  const rows = await sql().query(`SELECT nx.part, nx.at FROM (SELECT $1::uuid AS id) s ${NEXT_PART}`, [seriesId]);
  return rows[0]?.part ? { part: Number(rows[0].part), at: new Date(rows[0].at as string).toISOString() } : null;
}

async function readOr<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isMissingTable(e)) return fallback;
    throw e;
  }
}

/**
 * The next part that is scheduled (published with a future date). Only its number and time are ever shown
 * publicly, never its title or anything else about it.
 */
export interface NextPart {
  part: number;
  at: string;
}

export interface PublicSeries extends Series {
  /** Published, public parts. */
  published: number;
  /** Highest published part number (parts can skip numbers). */
  last_part: number;
  /** Cover of the latest part. */
  cover_media_id: string | null;
  /** Covers of the published parts in part order (parts without one are skipped), for the card's crossfade. */
  covers: string[];
  next: NextPart | null;
}

export interface SeriesPart {
  id: string;
  slug: string;
  title: string;
  dek: string;
  part: number;
  published_at: string;
  read_minutes: number;
  cover_media_id: string | null;
}

/** Public series that have at least one published part, most recently updated first. */
export async function listPublicSeries(limit = 24): Promise<PublicSeries[]> {
  return readOr([], async () => {
    const rows = await sql().query(
      `SELECT s.id, s.slug, s.title, s.description, s.planned_parts, s.is_public, s.created_at, s.updated_at,
              count(e.id)::int AS published,
              max(sp.part)::int AS last_part,
              (array_agg(e.cover_media_id ORDER BY sp.part DESC) FILTER (WHERE e.cover_media_id IS NOT NULL))[1] AS cover_media_id,
              (array_agg(e.cover_media_id ORDER BY sp.part) FILTER (WHERE e.cover_media_id IS NOT NULL))[1:${MAX_COVERS}] AS covers,
              max(nx.part) AS next_part, max(nx.at) AS next_at,
              max(e.published_at) AS last_published
       FROM series s
       JOIN series_parts sp ON sp.series_id = s.id
       JOIN entries e ON e.id = sp.entry_id AND ${PUBLIC_POST}
       ${NEXT_PART}
       WHERE s.is_public = true
       GROUP BY s.id
       ORDER BY last_published DESC
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map(({ next_part, next_at, covers, ...r }) => ({
      ...r,
      covers: [...new Set((covers as string[] | null) ?? [])],
      next: next_part ? { part: Number(next_part), at: new Date(next_at as string).toISOString() } : null,
    })) as PublicSeries[];
  });
}

/** A public series and its published parts in order, or null. */
export async function getPublicSeries(slug: string): Promise<{ series: Series; parts: SeriesPart[]; next: NextPart | null } | null> {
  return readOr(null, async () => {
    const s = await sql().query(`SELECT ${SERIES_COLS} FROM series WHERE slug = $1 AND is_public = true`, [slug]);
    if (!s[0]) return null;
    const parts = await sql().query(
      `SELECT e.id, e.slug, e.title, e.dek, sp.part, e.published_at, e.read_minutes, e.cover_media_id
       FROM series_parts sp JOIN entries e ON e.id = sp.entry_id AND ${PUBLIC_POST}
       WHERE sp.series_id = $1 ORDER BY sp.part`,
      [s[0].id],
    );
    if (!parts.length) return null;
    return { series: s[0] as Series, parts: parts as SeriesPart[], next: await nextPart(s[0].id as string) };
  });
}

/** The series a public story is part of, with its published parts, or null. */
export async function seriesForEntry(entryId: string): Promise<{ series: Series; parts: SeriesPart[]; part: number; next: NextPart | null } | null> {
  return readOr(null, async () => {
    const own = await sql().query(
      `SELECT s.id, s.slug, s.title, s.description, s.planned_parts, s.is_public, s.created_at, s.updated_at, sp.part
       FROM series_parts sp JOIN series s ON s.id = sp.series_id
       WHERE sp.entry_id = $1 AND s.is_public = true`,
      [entryId],
    );
    if (!own[0]) return null;
    const { part, ...series } = own[0] as Series & { part: number };
    const parts = await sql().query(
      `SELECT e.id, e.slug, e.title, e.dek, sp.part, e.published_at, e.read_minutes, e.cover_media_id
       FROM series_parts sp JOIN entries e ON e.id = sp.entry_id AND ${PUBLIC_POST}
       WHERE sp.series_id = $1 ORDER BY sp.part`,
      [series.id],
    );
    return { series, parts: parts as SeriesPart[], part, next: await nextPart(series.id) };
  });
}

// ---------------- admin ----------------

/** Every series (the picker in the story editor). The Series screen uses adminPageSeries. */
export async function adminListSeries(): Promise<SeriesAdminRow[]> {
  const rows = await sql().query(
    `SELECT s.id, s.slug, s.title, s.description, s.planned_parts, s.is_public, s.created_at, s.updated_at,
            count(e.id) FILTER (WHERE e.status = 'published' AND e.is_public AND e.published_at <= now())::int AS published,
            count(e.id) FILTER (WHERE e.status = 'published' AND e.is_public AND e.published_at > now())::int AS scheduled,
            count(e.id) FILTER (WHERE e.status <> 'published' OR NOT e.is_public)::int AS drafts
     FROM series s
     LEFT JOIN series_parts sp ON sp.series_id = s.id
     LEFT JOIN entries e ON e.id = sp.entry_id
     GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 200`,
    [],
  );
  return rows as SeriesAdminRow[];
}

export type SeriesShowFilter = 'all' | 'public' | 'hidden';
const SERIES_SHOW: Record<SeriesShowFilter, string> = { all: 'true', public: 's.is_public', hidden: 'NOT s.is_public' };

/** One page of the admin list, newest edit first. `like` is a ready ILIKE pattern (or null for no search). */
export async function adminPageSeries(opts: { show: SeriesShowFilter; like: string | null; size: number; offset: number }): Promise<{ series: SeriesAdminRow[]; total: number; counts: Record<SeriesShowFilter, number> }> {
  const where = `(${SERIES_SHOW[opts.show]}) AND ($1::text IS NULL OR s.title ILIKE $1 OR s.slug ILIKE $1)`;
  const [rows, matched, counts] = await Promise.all([
    sql().query(
      `SELECT s.id, s.slug, s.title, s.description, s.planned_parts, s.is_public, s.created_at, s.updated_at,
              count(e.id) FILTER (WHERE e.status = 'published' AND e.is_public AND e.published_at <= now())::int AS published,
              count(e.id) FILTER (WHERE e.status = 'published' AND e.is_public AND e.published_at > now())::int AS scheduled,
              count(e.id) FILTER (WHERE e.status <> 'published' OR NOT e.is_public)::int AS drafts
       FROM series s
       LEFT JOIN series_parts sp ON sp.series_id = s.id
       LEFT JOIN entries e ON e.id = sp.entry_id
       WHERE ${where}
       GROUP BY s.id ORDER BY s.updated_at DESC, s.id LIMIT $2 OFFSET $3`,
      [opts.like, opts.size, opts.offset],
    ),
    sql().query(`SELECT count(*)::int AS n FROM series s WHERE ${where}`, [opts.like]),
    sql().query(`SELECT count(*)::int AS all, count(*) FILTER (WHERE is_public)::int AS public, count(*) FILTER (WHERE NOT is_public)::int AS hidden FROM series`, []),
  ]);
  const c = (counts[0] ?? {}) as Record<string, number>;
  return {
    series: rows as SeriesAdminRow[],
    total: Number((matched[0] as { n?: number })?.n ?? 0),
    counts: { all: Number(c.all ?? 0), public: Number(c.public ?? 0), hidden: Number(c.hidden ?? 0) },
  };
}

export async function createSeries(input: SeriesInput): Promise<Series> {
  const rows = await sql().query(
    `INSERT INTO series (slug, title, description, planned_parts, is_public) VALUES ($1,$2,$3,$4,$5) RETURNING ${SERIES_COLS}`,
    [input.slug, input.title, input.description, input.planned_parts, input.is_public],
  );
  return rows[0] as Series;
}

export async function updateSeries(id: string, input: SeriesInput): Promise<Series | null> {
  const rows = await sql().query(
    `UPDATE series SET slug=$2, title=$3, description=$4, planned_parts=$5, is_public=$6, updated_at=now()
     WHERE id = $1 RETURNING ${SERIES_COLS}`,
    [id, input.slug, input.title, input.description, input.planned_parts, input.is_public],
  );
  return (rows[0] as Series) ?? null;
}

export async function deleteSeries(id: string): Promise<void> {
  await sql().query('DELETE FROM series WHERE id = $1', [id]);
}

/** A story's series and part (admin), or nulls. */
export async function getEntrySeries(entryId: string): Promise<{ seriesId: string | null; part: number | null }> {
  const rows = await sql().query('SELECT series_id, part FROM series_parts WHERE entry_id = $1', [entryId]);
  return rows[0] ? { seriesId: rows[0].series_id as string, part: rows[0].part as number } : { seriesId: null, part: null };
}

/** Parts already taken in a series (admin), to suggest the next free number. */
export async function takenParts(seriesId: string): Promise<{ part: number; entry_id: string; title: string }[]> {
  const rows = await sql().query(
    `SELECT sp.part, sp.entry_id, e.title FROM series_parts sp JOIN entries e ON e.id = sp.entry_id
     WHERE sp.series_id = $1 ORDER BY sp.part`,
    [seriesId],
  );
  return rows as { part: number; entry_id: string; title: string }[];
}

export class PartTakenError extends Error {}

/**
 * Put a story in a series as part N (null = the next free number), or take it out (seriesId null).
 * Only stories can be parts. A part number already used by another story is refused.
 */
export async function setEntrySeries(entryId: string, seriesId: string | null, part: number | null): Promise<{ seriesId: string | null; part: number | null }> {
  if (!seriesId) {
    await sql().query('DELETE FROM series_parts WHERE entry_id = $1', [entryId]);
    return { seriesId: null, part: null };
  }
  try {
    const rows = await sql().query(
      `INSERT INTO series_parts (entry_id, series_id, part)
       SELECT e.id, s.id, COALESCE($3::int, (SELECT COALESCE(max(part), 0) + 1 FROM series_parts WHERE series_id = s.id AND entry_id <> e.id))
       FROM entries e, series s WHERE e.id = $1 AND e.kind = 'post' AND s.id = $2
       ON CONFLICT (entry_id) DO UPDATE SET series_id = EXCLUDED.series_id, part = EXCLUDED.part
       RETURNING series_id, part`,
      [entryId, seriesId, part],
    );
    if (!rows[0]) throw new Error('Not found');
    return { seriesId: rows[0].series_id as string, part: rows[0].part as number };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') throw new PartTakenError('Another story is already that part');
    if (code === '23514') throw new PartTakenError('Part numbers go from 1 to 99');
    throw e;
  }
}
