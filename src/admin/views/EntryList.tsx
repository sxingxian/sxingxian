import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { Pager, setUrlParams, usePaging } from '../components/Pager';
import { pageCount } from '../../lib/shared/paging';
import { relTime } from '../components/ui';
import { Page, Panel, Segmented, Empty } from '../components/kit';
import { KIND_SECTION, SECTIONS } from '../nav';
import { KIND_LABELS, KIND_PATH, type Entry, type EntryKind, type FeaturedSetting, featuredIds } from '../../lib/shared/types';
import { entryState, STATE_LABEL, whenLabel, type EntryState } from '../../lib/shared/state';

type Row = Omit<Entry, 'body'>;
type Filter = 'all' | EntryState;
interface PageData { entries: Row[]; total: number; counts: Record<Filter, number> }
const FILTERS = new Set<Filter>(['all', 'draft', 'scheduled', 'published']);

const PILL: Record<EntryState, string> = { draft: 'pill', scheduled: 'pill sched', published: 'pill ok' };
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

export default function EntryList({ kind, go }: { kind: EntryKind; go: (p: string) => void }) {
  const params = new URL(window.location.href).searchParams;
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilterState] = useState<Filter>(() => (FILTERS.has(params.get('show') as Filter) ? (params.get('show') as Filter) : 'all'));
  const [q, setQ] = useState(() => (params.get('q') ?? '').slice(0, 100));
  const [query, setQuery] = useState(q.trim()); // the search actually sent, a moment after typing stops
  const paging = usePaging(`entries-${kind}`);
  const [now, setNow] = useState(() => Date.now());
  // Phones: the filter drops its counts to fit one line (the counts are in the line under the title).
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // A new search or filter starts again at page 1; both live in the address with the page.
  const setFilter = (f: Filter) => { setFilterState(f); setUrlParams({ show: f === 'all' ? null : f }); paging.reset(); };
  useEffect(() => {
    const t = setTimeout(() => {
      const next = q.trim();
      if (next === query) return;
      setQuery(next);
      setUrlParams({ q: next || null });
      paging.reset();
    }, 250);
    return () => clearTimeout(t);
  }, [q, query, paging]);

  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current; // only the latest request may fill the list
    setLoading(true);
    const qs = new URLSearchParams({ kind, page: String(paging.page), size: String(paging.size), state: filter });
    if (query) qs.set('q', query);
    api.get<PageData>(`/api/admin/entries?${qs}`).then((r) => {
      if (mine !== seq.current) return;
      // Past the last page (entries deleted, or an old link): show the last page instead.
      if (r.entries.length === 0 && r.total > 0 && paging.page > 1) { paging.setPage(pageCount(r.total, paging.size)); return; }
      setData(r);
      setErr('');
      setLoading(false);
    }).catch((e) => { if (mine === seq.current) { setErr(errorText(e)); setLoading(false); } });
  }, [kind, paging, filter, query]);
  useEffect(() => {
    if (kind === 'post') api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
  }, [kind]);
  // Scheduled entries turn Published on their own; keep the labels honest while it's open.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const title = SECTIONS[KIND_SECTION[kind]].label;
  const noun = KIND_LABELS[kind].toLowerCase();
  const counts = data?.counts;
  const count = (s: EntryState) => counts?.[s] ?? 0;
  const shown = (data?.entries ?? []).map((r) => ({ r, state: entryState(r, now) }));
  const sub = counts ? [`${counts.all} total`, count('scheduled') ? `${count('scheduled')} scheduled` : '', `${count('draft')} ${count('draft') === 1 ? 'draft' : 'drafts'}`].filter(Boolean).join(' · ') : undefined;

  return (
    <Page title={title} section={KIND_SECTION[kind]} width="wide" sub={sub}
      actions={<button type="button" className="btn primary" onClick={() => go(`/admin/edit/new?kind=${kind}`)}>+ New {noun}</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      <Panel flush title="Entries"
        actions={(
          <>
            <input className="input search-input" type="search" placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="entry-filter"><Segmented label="Show" value={filter} onChange={setFilter}
              options={[['all', 'All'], ['published', `Published${counts && !narrow ? ` ${count('published')}` : ''}`], ['scheduled', `Scheduled${counts && !narrow ? ` ${count('scheduled')}` : ''}`], ['draft', `Drafts${counts && !narrow ? ` ${count('draft')}` : ''}`]] as const} /></div>
          </>
        )}>
        {data === null ? (
          <Empty>{err ? '' : 'Loading…'}</Empty>
        ) : shown.length === 0 ? (
          <Empty>{data.counts.all === 0 ? 'Nothing yet.' : filter !== 'all' && !query ? `No ${STATE_LABEL[filter as EntryState].toLowerCase()} ${noun === 'story' ? 'stories' : `${noun}s`}.` : 'No matches.'}</Empty>
        ) : (
          <div className={`table-box flat${loading ? ' is-loading' : ''}`} aria-busy={loading}>
            <table>
              <thead><tr><th>Title</th><th>Topics</th><th>Status</th><th>Updated</th><th aria-hidden="true" /></tr></thead>
              <tbody>
                {shown.map(({ r, state }) => {
                  const isFeatured = featuredIds(featured).includes(r.id);
                  const href = `/admin/edit/${r.id}`;
                  const open = (e: { preventDefault: () => void }) => { e.preventDefault(); go(href); };
                  const when = state === 'draft' ? `Edited ${relTime(r.updated_at)}` : state === 'scheduled' ? whenLabel(r.published_at!, now) : r.published_at ? dateOnly(r.published_at) : '';
                  return (
                    <tr key={r.id}>
                      <td className="c-title">
                        <a className="title" href={href} onClick={open}>{r.title}</a>
                        {isFeatured && <span className="pill ok" style={{ marginLeft: 8 }}>featured</span>}
                        {state === 'published' && r.has_edits && <span className="row-note">Edits not live</span>}
                        <div className="status">{KIND_PATH[r.kind]}/{r.slug}</div>
                      </td>
                      <td className="c-topic">{r.topics?.length ? r.topics.join(', ') : '—'}</td>
                      <td className="c-status"><span className={PILL[state]}>{STATE_LABEL[state]}</span><span className="when">{when}</span></td>
                      <td className="status c-upd">{relTime(r.updated_at)}</td>
                      <td className="c-go"><a href={href} onClick={open} tabIndex={-1} aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 3l5 5-5 5" /></svg>
                      </a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager paging={paging} total={data.total} label={`${title} pages`} />}
      </Panel>
    </Page>
  );
}
