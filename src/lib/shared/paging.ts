// One rule for every paged list in the admin: 10 per page unless 25, 50 or 100 is chosen.
// Used by the API (to read ?page=&size=) and by the admin's pager, so both agree.

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;
export const MAX_PAGE = 10_000;

/** A page size from a query string or storage; anything not on the list becomes 10. */
export function parseSize(raw: string | null | undefined): PageSize {
  if (!raw || !/^\d{2,3}$/.test(raw)) return DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

/** A 1-based page number; anything odd becomes 1. */
export function parsePage(raw: string | null | undefined): number {
  if (!raw || !/^\d{1,5}$/.test(raw)) return 1;
  return Math.min(Math.max(Number(raw), 1), MAX_PAGE);
}

export interface Paging { page: number; size: PageSize; offset: number }

/** ?page=&size= (or ?<prefix>page=&<prefix>size= when one screen has two lists). */
export function readPaging(params: URLSearchParams, prefix = ''): Paging {
  const page = parsePage(params.get(`${prefix}page`));
  const size = parseSize(params.get(`${prefix}size`));
  return { page, size, offset: (page - 1) * size };
}

export const pageCount =(total: number, size: number) => Math.max(1, Math.ceil(total / size));

/** The page that keeps the first row in view when the page size changes. */
export function pageAfterResize(page: number, from: number, to: number): number {
  return Math.floor(((page - 1) * from) / to) + 1;
}

/**
 * The page buttons to draw: always the first and last, the current page with one either side,
 * and a gap ('…') wherever pages are skipped. 1 2 [3] 4 … 15 · 1 … 6 [7] 8 … 15 · 1 … 12 13 [14] 15
 */
export function pageList(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 4) [2, 3, 4, 5].forEach((p) => keep.add(p));
  if (page >= pages - 3) [pages - 4, pages - 3, pages - 2, pages - 1].forEach((p) => keep.add(p));
  const out: (number | 'gap')[] = [];
  let last = 0;
  for (const p of [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push('gap');
    out.push(p);
    last = p;
  }
  return out;
}

/** "%" and "_" typed in a search box mean themselves, not wildcards. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
