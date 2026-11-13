// The pager under every long list in the admin: "Showing 11–20 of 143", rows per page (10 · 25 · 50 · 100),
// and page buttons (phones: Prev / Next and a page menu). usePaging keeps the page in the address, so
// opening an item and coming back lands on the same page, and remembers the page size per list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageAfterResize, pageCount, pageList, parsePage, parseSize, type PageSize } from '../../lib/shared/paging';

const SIZE_KEY = 'sx-rows:';
const LIST_KEY = 'sx-list:';

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}

/** Put (or clear) URL parameters without a new history entry or a scroll jump. */
export function setUrlParams(changes: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = url.pathname + url.search + url.hash;
  window.history.replaceState(window.history.state, '', next);
  rememberList();
}

/** The list address last seen for this screen, so the breadcrumb back link returns to the same page and filter. */
function rememberList() {
  try { window.sessionStorage.setItem(LIST_KEY + window.location.pathname, window.location.pathname + window.location.search); } catch { /* ignore */ }
}
export function lastListUrl(path: string): string {
  try {
    const v = window.sessionStorage.getItem(LIST_KEY + path);
    if (v && (v === path || v.startsWith(`${path}?`))) return v;
  } catch { /* ignore */ }
  return path;
}

export interface PagingState {
  page: number; size: PageSize;
  setPage: (p: number) => void;
  setSize: (s: PageSize) => void;
  /** Back to page 1 (a new search or filter). */
  reset: () => void;
}

/** Page (from ?page=, or ?<prefix>page=) and page size (remembered per list in this browser). */
export function usePaging(list: string, prefix = ''): PagingState {
  const param = `${prefix}page`;
  const [page, setPageState] = useState(() => parsePage(new URL(window.location.href).searchParams.get(param)));
  const [size, setSizeState] = useState<PageSize>(() => parseSize(readStored(SIZE_KEY + list)));
  const setPage = useCallback((p: number) => {
    const n = Math.max(1, Math.floor(p));
    setPageState(n);
    setUrlParams({ [param]: n === 1 ? null : String(n) });
  }, [param]);
  // Keeps the first row on screen: row 21 at 10 per page (page 3) is on page 1 at 25 per page.
  const setSize = useCallback((s: PageSize) => {
    writeStored(SIZE_KEY + list, String(s));
    setSizeState(s);
    setPage(pageAfterResize(page, size, s));
  }, [list, page, size, setPage]);
  const reset = useCallback(() => setPage(1), [setPage]);
  useEffect(rememberList, []);
  // Stable between renders unless the page or size changes, so it can be an effect's dependency.
  return useMemo(() => ({ page, size, setPage, setSize, reset }), [page, size, setPage, setSize, reset]);
}

const Chevron = ({ dir }: { dir: 'l' | 'r' }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d={dir === 'l' ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'} />
  </svg>
);

/**
 * Draw under a list. Hidden when the list is empty; with one page only the count (and rows per page
 * once there are more than 10) stays.
 */
export function Pager({ paging, total, label = 'Pages' }: { paging: PagingState; total: number; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  if (total <= 0) return null;
  const { page, size } = paging;
  const pages = pageCount(total, size);
  const cur = Math.min(page, pages);
  const from = (cur - 1) * size + 1;
  const to = Math.min(cur * size, total);

  // After moving page, bring the top of the list back into view if it has scrolled away.
  const goTo = (p: number) => {
    if (p < 1 || p > pages || p === cur) return;
    paging.setPage(p);
    const box = ref.current?.closest('.panel, .table-box, .pager-scope') as HTMLElement | null;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start' });
  };

  return (
    <nav className="pager" aria-label={label} ref={ref}>
      <span className="pager-count" aria-live="polite">
        <span className="pager-showing">Showing </span><b>{from === to ? from : `${from}–${to}`}</b> of <b>{total}</b>
      </span>
      {total > DEFAULT_PAGE_SIZE && (
        <label className="pager-size">
          <span className="pager-size-long">Rows per page</span><span className="pager-size-short">Rows</span>
          <select className="select" value={size} onChange={(e) => paging.setSize(parseSize(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {pages > 1 && (
        <div className="pager-nav">
          <button type="button" className="pager-step" onClick={() => goTo(cur - 1)} disabled={cur <= 1} aria-label="Previous page">
            <Chevron dir="l" /><span className="pager-step-text">Prev</span>
          </button>
          <ol className="pager-pages">
            {pageList(cur, pages).map((p, i) => (
              <li key={p === 'gap' ? `gap${i}` : p}>
                {p === 'gap' ? <span className="pager-gap" aria-hidden="true">…</span> : (
                  <button type="button" className="pager-num" aria-current={p === cur ? 'page' : undefined} aria-label={`Page ${p}`} onClick={() => goTo(p)}>{p}</button>
                )}
              </li>
            ))}
          </ol>
          <label className="pager-jump">
            Page
            <select className="select" value={cur} aria-label={`Page, of ${pages}`} onChange={(e) => goTo(Number(e.target.value))}>
              {Array.from({ length: pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
            of {pages}
          </label>
          <button type="button" className="pager-step" onClick={() => goTo(cur + 1)} disabled={cur >= pages} aria-label="Next page">
            <span className="pager-step-text">Next</span><Chevron dir="r" />
          </button>
        </div>
      )}
    </nav>
  );
}
