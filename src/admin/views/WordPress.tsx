import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Switch, relTime, useToast } from '../components/ui';
import { Empty, Page, Panel, Row, SaveBar, ToggleRow } from '../components/kit';
import type { ExternalPost, SiteSetting, WordPressSetting } from '../../lib/shared/types';

interface Source { status: 'up' | 'down'; status_since: string; consecutive_fail: number; last_check_at: string | null; last_check_ms: number | null; last_sync_at: string | null }
interface LogRow { at: string; event: string; result: string; ok: boolean }

export default function WordPress({ wpBaseUrl, wpAdminUrl }: { wpBaseUrl: string; wpAdminUrl: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [posts, setPosts] = useState<ExternalPost[]>([]);
  const [rules, setRules] = useState<WordPressSetting | null>(null);
  const [map, setMap] = useState<[string, string][]>([]);
  const [savedMap, setSavedMap] = useState('[]');
  const [topics, setTopics] = useState<string[]>([]);
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
    api.get<{ value: WordPressSetting }>('/api/admin/settings/wordpress').then((r) => {
      setRules(r.value);
      const entries = Object.entries(r.value.categoryMap);
      setMap(entries);
      setSavedMap(JSON.stringify(entries));
    }).catch(() => {});
    api.get<{ value: SiteSetting }>('/api/admin/settings/site').then((r) => setTopics(r.value.topics)).catch(() => {});
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
      const entries = Object.entries(r.value.categoryMap);
      setMap(entries);
      setSavedMap(JSON.stringify(entries));
      toast('Saved');
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
  const mapDirty = JSON.stringify(map) !== savedMap;

  return (
    <Page title="WordPress" sub={`Synced from ${wpBaseUrl.replace('https://', '')}`}
      crumbs={<><span>Site</span><span>/</span><b>WordPress</b></>}
      actions={<a className="btn" href={wpAdminUrl} target="_blank" rel="noopener noreferrer">WordPress admin ↗</a>}>
      {err && <p className="err-text" role="alert">{err}</p>}

      <Panel title="Status" actions={
        <>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => run('check')}>{busy === 'check' ? 'Checking…' : 'Check now'}</button>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => run('sync')}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => run('reconcile')}>{busy === 'reconcile' ? 'Checking…' : 'Full check'}</button>
        </>
      }>
        {source && (
          <Row label={down ? 'Down' : 'Online'} hint={down ? `since ${relTime(source.status_since)}` : `${visible} posts showing`}>
            <span className="state-line"><span className={`dot ${down ? 'bad' : 'good'}`} aria-hidden="true" />{down ? 'WordPress posts are hidden until it’s back.' : 'Posts are showing on the main site.'}</span>
            <span className="muted">Checked {relTime(source.last_check_at)}{source.last_check_ms ? ` · ${source.last_check_ms} ms` : ''} · synced {relTime(source.last_sync_at)}</span>
          </Row>
        )}
        <Row label="How it syncs">
          <dl className="facts">
            <dt>Instant</dt><dd>Webhook on publish, edit, delete</dd>
            <dt>~15 min</dt><dd>Catch-up pull</dd>
            <dt>Daily</dt><dd>Full check for removed posts</dd>
            <dt>Copied</dt><dd>Title, excerpt, image, link</dd>
          </dl>
        </Row>
      </Panel>

      {rules && (
        <Panel title="Rules">
          <ToggleRow label="Hide while down" hint="2 failed checks hide, 2 good ones show" checked={rules.hideWhenDown} onChange={(v) => saveRules({ ...rules, hideWhenDown: v })} />
          <ToggleRow label="Show new posts automatically" hint="Otherwise switch each one on below" checked={rules.autoShow} onChange={(v) => saveRules({ ...rules, autoShow: v })} />
          <ToggleRow label="Include in RSS" checked={rules.includeInRss} onChange={(v) => saveRules({ ...rules, includeInRss: v })} />
          <Row label="Category → topic" hint="WordPress category to story topic">
            {map.map(([k, v], i) => (
              <div key={i} className="input-row">
                <input className="input" aria-label="WordPress category" placeholder="WordPress category" value={k} onChange={(e) => setMap(map.map((m, j) => (j === i ? [e.target.value, m[1]] : m)))} />
                <select className="select" aria-label="Story topic" value={v} onChange={(e) => setMap(map.map((m, j) => (j === i ? [m[0], e.target.value] : m)))}>
                  <option value="">Topic…</option>
                  {[...new Set([...topics, ...(v ? [v] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="button" className="btn small" aria-label="Remove mapping" onClick={() => setMap(map.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div><button type="button" className="btn small" onClick={() => setMap([...map, ['', '']])}>+ Mapping</button></div>
          </Row>
          <SaveBar dirty={mapDirty} onSave={() => saveRules({ ...rules, categoryMap: Object.fromEntries(map.filter(([k, v]) => k.trim() && v.trim())) })} />
        </Panel>
      )}

      <Panel title="Posts" desc={`${posts.length} synced`} flush>
        {posts.length === 0 ? <Empty>Nothing synced yet.</Empty> : (
          <div className="list-rows">
            {posts.map((p) => (
              <div key={p.wp_id} className="list-row">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <a className="title" href={p.url} target="_blank" rel="noopener noreferrer">{p.title} ↗</a>
                  {p.removed_at && <span className="pill warn" style={{ marginLeft: 8 }}>removed on WP</span>}
                  <span className="meta" style={{ display: 'block' }}>{p.topic || 'No topic'} · {relTime(p.published_at)}</span>
                </span>
                <Switch checked={p.show_on_main} disabled={!!p.removed_at} label={`Show ${p.title} on the main site`} onChange={(v) => toggle(p, v)} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Activity" flush>
        {log.length === 0 ? <Empty>No activity yet.</Empty> : (
          <div className="list-rows">
            {log.map((l, i) => (
              <div key={i} className="list-row">
                <span><span className={`dot ${l.ok ? 'good' : 'bad'}`} aria-hidden="true" style={{ marginRight: 8 }} />{l.event}</span>
                <span className="meta">{l.result} · {relTime(l.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Page>
  );
}
