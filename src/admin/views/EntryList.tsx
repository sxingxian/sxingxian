import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { relTime } from '../components/ui';
import { Page, Panel, Segmented, Empty } from '../components/kit';
import { KIND_SECTION, SECTIONS } from '../nav';
import { KIND_LABELS, KIND_PATH, type Entry, type EntryKind, type FeaturedSetting, featuredIds } from '../../lib/shared/types';
import { entryState, STATE_LABEL, whenLabel, type EntryState } from '../../lib/shared/state';

type Row = Omit<Entry, 'body'>;
type Filter = 'all' | EntryState;

const PILL: Record<EntryState, string> = { draft: 'pill', scheduled: 'pill sched', published: 'pill ok' };
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

export default function EntryList({ kind, go }: { kind: EntryKind; go: (p: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Phones: the filter drops its counts to fit one line (the counts are in the line under the title).
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    setRows(null);
    api.get<{ entries: Row[] }>(`/api/admin/entries?kind=${kind}`).then((r) => setRows(r.entries)).catch((e) => setErr(errorText(e)));
    if (kind === 'post') api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
  }, [kind]);
  // Scheduled entries turn Published on their own; keep the list honest while it's open.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const title = SECTIONS[KIND_SECTION[kind]].label;
  const noun = KIND_LABELS[kind].toLowerCase();
  const needle = q.trim().toLowerCase();
  const withState = (rows ?? []).map((r) => ({ r, state: entryState(r, now) }));
  const count = (s: EntryState) => withState.filter((x) => x.state === s).length;
  const shown = withState.filter(({ r, state }) => (filter === 'all' || state === filter) && (!needle || r.title.toLowerCase().includes(needle) || (r.topics ?? []).some((t) => t.toLowerCase().includes(needle))));
  const sub = rows ? [`${rows.length} total`, count('scheduled') ? `${count('scheduled')} scheduled` : '', `${count('draft')} ${count('draft') === 1 ? 'draft' : 'drafts'}`].filter(Boolean).join(' · ') : undefined;

  return (
    <Page title={title} section={KIND_SECTION[kind]} width="wide" sub={sub}
      actions={<button type="button" className="btn primary" onClick={() => go(`/admin/edit/new?kind=${kind}`)}>+ New {noun}</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      <Panel flush title="Entries"
        actions={(
          <>
            <input className="input search-input" type="search" placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="entry-filter"><Segmented label="Show" value={filter} onChange={setFilter}
              options={[['all', 'All'], ['published', `Published${rows && !narrow ? ` ${count('published')}` : ''}`], ['scheduled', `Scheduled${rows && !narrow ? ` ${count('scheduled')}` : ''}`], ['draft', `Drafts${rows && !narrow ? ` ${count('draft')}` : ''}`]] as const} /></div>
          </>
        )}>
        {rows === null ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{rows.length === 0 ? 'Nothing yet.' : filter !== 'all' && !needle ? `No ${STATE_LABEL[filter as EntryState].toLowerCase()} ${noun === 'story' ? 'stories' : `${noun}s`}.` : 'No matches.'}</Empty>
        ) : (
          <div className="table-box flat">
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
      </Panel>
    </Page>
  );
}
