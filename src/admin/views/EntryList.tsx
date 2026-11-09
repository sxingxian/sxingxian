import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Switch, relTime, useToast } from '../components/ui';
import { Page, Panel, Segmented, Empty } from '../components/kit';
import { KIND_LABELS, KIND_PATH, type Entry, type EntryKind, type FeaturedSetting } from '../../lib/shared/types';

type Row = Omit<Entry, 'body'>;

export default function EntryList({ kind, go }: { kind: EntryKind; go: (p: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [q, setQ] = useState('');
  const toast = useToast();

  useEffect(() => {
    setRows(null);
    api.get<{ entries: Row[] }>(`/api/admin/entries?kind=${kind}`).then((r) => setRows(r.entries)).catch((e) => setErr(errorText(e)));
    if (kind === 'post') api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
  }, [kind]);

  const toggle = async (row: Row, next: boolean) => {
    setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, is_public: next } : r)) ?? null);
    try {
      await api.patch(`/api/admin/entries/${row.id}`, { is_public: next });
      toast(next ? 'Now public' : 'Hidden from the site');
    } catch (e) {
      setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, is_public: !next } : r)) ?? null);
      toast(errorText(e));
    }
  };

  const title = kind === 'post' ? 'Stories' : KIND_LABELS[kind] === 'Work' ? 'Work' : kind === 'gallery' ? 'Photos' : 'Film';
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => (filter === 'all' || r.status === filter) && (!needle || r.title.toLowerCase().includes(needle) || (r.topic ?? '').toLowerCase().includes(needle)));
  const drafts = (rows ?? []).filter((r) => r.status !== 'published').length;

  return (
    <Page title={title} width="wide" sub={rows ? `${rows.length} total · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : undefined}
      actions={<button type="button" className="btn primary" onClick={() => go(`/admin/edit/new?kind=${kind}`)}>+ New {KIND_LABELS[kind].toLowerCase()}</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      <Panel flush title="Entries"
        actions={(
          <>
            <input className="input search-input" type="search" placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
            <Segmented label="Status" value={filter} onChange={setFilter} options={[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']] as const} />
          </>
        )}>
        {rows === null ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{rows.length === 0 ? 'Nothing yet.' : 'No matches.'}</Empty>
        ) : (
          <div className="table-box flat">
            <table>
              <thead><tr><th>Title</th><th>Topic</th><th>Status</th><th>Updated</th><th style={{ textAlign: 'right' }}>Show publicly</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const isFeatured = featured?.mode === 'manual' && featured.entryId === r.id;
                  return (
                    <tr key={r.id}>
                      <td className="c-title">
                        <a className="title" href={`/admin/edit/${r.id}`} onClick={(e) => { e.preventDefault(); go(`/admin/edit/${r.id}`); }}>{r.title}</a>
                        {isFeatured && <span className="pill ok" style={{ marginLeft: 8 }}>featured</span>}
                        <div className="status">{KIND_PATH[r.kind]}/{r.slug}</div>
                      </td>
                      <td className="c-topic">{r.topic || '—'}</td>
                      <td className="c-status"><span className={`pill${r.status === 'published' ? ' ok' : ''}`}>{r.status === 'published' ? 'Published' : 'Draft'}</span></td>
                      <td className="status c-upd">{relTime(r.updated_at)}</td>
                      <td className="c-pub" style={{ textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                          <span className="hint">{r.status !== 'published' ? 'Publish first' : r.is_public ? 'Public' : 'Hidden'}</span>
                          <Switch checked={r.is_public && r.status === 'published'} disabled={r.status !== 'published'} label={`Show ${r.title} publicly`} onChange={(v) => toggle(r, v)} />
                        </span>
                      </td>
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
