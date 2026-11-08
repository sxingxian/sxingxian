import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Switch, relTime, useToast } from '../components/ui';
import type { ExternalPost, WordPressSetting } from '../../lib/shared/types';

interface Source { status: 'up' | 'down'; status_since: string; consecutive_fail: number; last_check_at: string | null; last_check_ms: number | null; last_sync_at: string | null }
interface LogRow { at: string; event: string; result: string; ok: boolean }

export default function WordPress({ wpBaseUrl, wpAdminUrl }: { wpBaseUrl: string; wpAdminUrl: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [posts, setPosts] = useState<ExternalPost[]>([]);
  const [rules, setRules] = useState<WordPressSetting | null>(null);
  const [map, setMap] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();

  const load = useCallback(() => {
    api.get<{ source: Source; log: LogRow[]; posts: ExternalPost[] }>('/api/admin/wordpress')
      .then((r) => { setSource(r.source); setLog(r.log); setPosts(r.posts); })
      .catch((e) => setErr(errorText(e)));
  }, []);

  useEffect(() => {
    load();
    api.get<{ value: WordPressSetting }>('/api/admin/settings/wordpress').then((r) => { setRules(r.value); setMap(Object.entries(r.value.categoryMap)); }).catch(() => {});
  }, [load]);

  const run = async (action: 'sync' | 'check' | 'reconcile') => {
    setBusy(action);
    try {
      await api.post('/api/admin/wordpress', { action });
      toast(action === 'sync' ? 'Synced' : action === 'check' ? 'Checked' : 'Full check done');
      load();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const saveRules = async (next: WordPressSetting) => {
    try {
      const r = await api.put<{ value: WordPressSetting }>('/api/admin/settings/wordpress', next);
      setRules(r.value);
      toast('Rules saved');
    } catch (e) {
      toast(errorText(e));
    }
  };

  const toggle = async (p: ExternalPost, show: boolean) => {
    setPosts((ps) => ps.map((x) => (x.wp_id === p.wp_id ? { ...x, show_on_main: show } : x)));
    try {
      await api.post('/api/admin/wordpress', { action: 'visibility', wp_id: p.wp_id, show });
    } catch (e) {
      setPosts((ps) => ps.map((x) => (x.wp_id === p.wp_id ? { ...x, show_on_main: !show } : x)));
      toast(errorText(e));
    }
  };

  const visible = posts.filter((p) => p.show_on_main && !p.removed_at).length;
  const down = source?.status === 'down';

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><span>Settings</span><span>/</span><b>WordPress journal</b></div>
        <div className="actions"><a className="btn" href={wpAdminUrl} target="_blank" rel="noopener noreferrer">Open WordPress admin ↗</a></div>
      </div>
      <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1>WordPress journal</h1>
          <p className="sub">Posts published on {wpBaseUrl.replace('https://', '')} appear in the main feed as cards that link back. WordPress stays where you write them.</p>
        </div>
        {err && <p className="err-text">{err}</p>}
        {source && (
          <div className={`banner ${down ? 'down' : 'ok'}`} role="status">
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="dot" style={{ background: down ? '#b4421e' : '#1e7a4f' }} />
              <span>
                <b>{down ? `Unreachable since ${relTime(source.status_since)} — WordPress posts are hidden` : `Reachable — ${visible} WordPress posts are showing`}</b>
                <br />
                <span className="status">last check {relTime(source.last_check_at)}{source.last_check_ms ? ` · ${source.last_check_ms} ms` : ''} · last sync {relTime(source.last_sync_at)}</span>
              </span>
            </span>
            <span className="actions">
              <button type="button" className="btn" disabled={!!busy} onClick={() => run('check')}>{busy === 'check' ? 'Checking…' : 'Check now'}</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => run('sync')}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => run('reconcile')}>{busy === 'reconcile' ? 'Checking…' : 'Full check'}</button>
            </span>
          </div>
        )}

        <div className="grid2">
          {rules && (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="lbl">Rules</div>
              <label className="check"><input type="checkbox" checked={rules.hideWhenDown} onChange={(e) => saveRules({ ...rules, hideWhenDown: e.target.checked })} />Hide WordPress posts while WordPress is down (checked every 5 min; 2 fails hide, 2 OKs show)</label>
              <label className="check"><input type="checkbox" checked={rules.autoShow} onChange={(e) => saveRules({ ...rules, autoShow: e.target.checked })} />Show new WordPress posts automatically (otherwise switch each one on below)</label>
              <label className="check"><input type="checkbox" checked={rules.includeInRss} onChange={(e) => saveRules({ ...rules, includeInRss: e.target.checked })} />Include WordPress posts in RSS</label>
              <div className="lbl" style={{ marginTop: 6 }}>WordPress category → journal topic</div>
              {map.map(([k, v], i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 6, alignItems: 'center' }}>
                  <input className="input" aria-label="WordPress category" value={k} onChange={(e) => setMap(map.map((m, j) => (j === i ? [e.target.value, m[1]] : m)))} />
                  <span className="hint">→</span>
                  <input className="input" aria-label="Topic" value={v} onChange={(e) => setMap(map.map((m, j) => (j === i ? [m[0], e.target.value] : m)))} />
                  <button type="button" className="btn small" aria-label="Remove mapping" onClick={() => setMap(map.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <div className="actions">
                <button type="button" className="btn small" onClick={() => setMap([...map, ['', '']])}>+ Add mapping</button>
                <button type="button" className="btn small primary" onClick={() => saveRules({ ...rules, categoryMap: Object.fromEntries(map.filter(([k, v]) => k.trim() && v.trim())) })}>Save mappings</button>
              </div>
            </section>
          )}
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="lbl">How syncing works</div>
            <p className="hint" style={{ margin: 0 }}>1. The sxingxian-sync plugin on WordPress pings this site when you publish, edit or delete. The site then fetches that post from WordPress itself.</p>
            <p className="hint" style={{ margin: 0 }}>2. Every 15 minutes the site pulls anything changed, in case a ping was missed.</p>
            <p className="hint" style={{ margin: 0 }}>3. Every night at 03:00 SGT a full check removes posts deleted, trashed or made private on WordPress.</p>
            <p className="hint" style={{ margin: 0 }}>Only titles, excerpts, images and links are copied. Readers open the full post on WordPress.</p>
          </section>
        </div>

        <section>
          <div className="lbl" style={{ marginBottom: 8 }}>Posts from WordPress</div>
          <div className="table-box">
            {posts.length === 0 ? <div className="empty">No posts synced yet. Press “Sync now”.</div> : (
              <table>
                <thead><tr><th>Title</th><th>Topic</th><th>Published</th><th style={{ textAlign: 'right' }}>Show on main site</th></tr></thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.wp_id}>
                      <td><a className="title" href={p.url} target="_blank" rel="noopener noreferrer">{p.title} ↗</a>{p.removed_at && <span className="pill warn" style={{ marginLeft: 8 }}>removed on WP</span>}</td>
                      <td>{p.topic}</td>
                      <td className="status">{relTime(p.published_at)}</td>
                      <td style={{ textAlign: 'right' }}><Switch checked={p.show_on_main} disabled={!!p.removed_at} label={`Show ${p.title}`} onChange={(v) => toggle(p, v)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section>
          <div className="lbl" style={{ marginBottom: 8 }}>Recent activity</div>
          <div className="table-box">
            {log.length === 0 ? <div className="empty">No activity yet.</div> : (
              <table><tbody>
                {log.map((l, i) => (
                  <tr key={i}><td className="status" style={{ width: 150 }}>{relTime(l.at)}</td><td>{l.event}</td><td className="status" style={{ textAlign: 'right', color: l.ok ? 'var(--accent)' : 'var(--danger)' }}>{l.result}</td></tr>
                ))}
              </tbody></table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
