import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Switch, relTime, useToast } from '../components/ui';
import { KIND_LABELS, KIND_PATH, type Entry, type EntryKind, type FeaturedSetting } from '../../lib/shared/types';

type Row = Omit<Entry, 'body'>;

export default function EntryList({ kind, go }: { kind: EntryKind; go: (p: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [err, setErr] = useState('');
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

  const title = kind === 'post' ? 'Journal' : KIND_LABELS[kind] === 'Work' ? 'Work' : kind === 'gallery' ? 'Photos' : 'Film';

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><b>{title}</b></div>
        <div className="actions"><button type="button" className="btn primary" onClick={() => go(`/admin/edit/new?kind=${kind}`)}>+ New {KIND_LABELS[kind].toLowerCase()}</button></div>
      </div>
      <div className="page">
        <h1>{title}</h1>
        <p className="sub">{kind === 'post' ? 'Posts written here. WordPress posts are managed under WordPress.' : 'Switch an entry off to hide it from the public site without deleting it.'}</p>
        {err && <p className="err-text">{err}</p>}
        <div className="table-box" style={{ marginTop: 18 }}>
          {rows === null ? (
            <div className="empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty">Nothing yet. Create your first {KIND_LABELS[kind].toLowerCase()}.</div>
          ) : (
            <table>
              <thead><tr><th>Title</th><th>Topic</th><th>Status</th><th>Updated</th><th style={{ textAlign: 'right' }}>Show publicly</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const isFeatured = featured?.mode === 'manual' && featured.entryId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        <a className="title" href={`/admin/edit/${r.id}`} onClick={(e) => { e.preventDefault(); go(`/admin/edit/${r.id}`); }}>{r.title}</a>
                        {isFeatured && <span className="pill ok" style={{ marginLeft: 8 }}>featured</span>}
                        <div className="status">{KIND_PATH[r.kind]}/{r.slug}</div>
                      </td>
                      <td>{r.topic || '—'}</td>
                      <td><span className={`pill${r.status === 'published' ? ' ok' : ''}`}>{r.status === 'published' ? 'Published' : 'Draft'}</span></td>
                      <td className="status">{relTime(r.updated_at)}</td>
                      <td style={{ textAlign: 'right' }}>
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
          )}
        </div>
      </div>
    </>
  );
}
