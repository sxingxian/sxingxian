import { useEffect, useRef, useState } from 'react';
import { drawWatermark, watermarkStored } from '../watermark';
import TopicsEditor, { type TopicChange } from '../components/TopicsEditor';
import { useDialog } from '../components/dialog';
import { api, errorText } from '../api';
import { Switch, useToast } from '../components/ui';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE, isSafeHref } from '../../lib/shared/safe';
import { SECTION_LABELS, type Entry, type FeaturedSetting, type FooterSetting, type SectionsSetting, type SiteSetting, type AdsSetting, type ProtectionSetting } from '../../lib/shared/types';

type Tab = 'home' | 'footer' | 'site' | 'photos' | 'ads';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('home');
  return (
    <>
      <div className="topbar"><div className="crumbs"><b>Settings</b></div></div>
      <div className="page">
        <h1>Settings</h1>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'home'} onClick={() => setTab('home')}>Sections &amp; featured post</button>
          <button type="button" role="tab" aria-selected={tab === 'footer'} onClick={() => setTab('footer')}>Footer</button>
          <button type="button" role="tab" aria-selected={tab === 'site'} onClick={() => setTab('site')}>Site</button>
          <button type="button" role="tab" aria-selected={tab === 'photos'} onClick={() => setTab('photos')}>Photos</button>
          <button type="button" role="tab" aria-selected={tab === 'ads'} onClick={() => setTab('ads')}>Ads</button>
        </div>
        {tab === 'home' && <HomeSettings />}
        {tab === 'footer' && <FooterSettings />}
        {tab === 'site' && <SiteSettings />}
        {tab === 'photos' && <PhotoSettings />}
        {tab === 'ads' && <AdsSettings />}
      </div>
    </>
  );
}

function HomeSettings() {
  const [sections, setSections] = useState<SectionsSetting | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [posts, setPosts] = useState<Omit<Entry, 'body'>[]>([]);
  const [err, setErr] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: SectionsSetting }>('/api/admin/settings/sections').then((r) => setSections(r.value)).catch((e) => setErr(errorText(e)));
    api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
    api.get<{ entries: Omit<Entry, 'body'>[] }>('/api/admin/entries?kind=post').then((r) => setPosts(r.entries.filter((e) => e.status === 'published' && e.is_public))).catch(() => {});
  }, []);

  const saveSections = async (next: SectionsSetting) => {
    const prev = sections;
    setSections(next);
    try {
      await api.put('/api/admin/settings/sections', next);
      toast('Sections updated');
    } catch (e) {
      setSections(prev);
      toast(errorText(e));
    }
  };

  const saveFeatured = async (next: FeaturedSetting) => {
    if (next.mode === 'manual' && !next.entryId) {
      setFeatured(next);
      return;
    }
    try {
      const r = await api.put<{ value: FeaturedSetting }>('/api/admin/settings/featured', next);
      setFeatured(r.value);
      toast('Featured post updated');
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div className="grid2">
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="lbl">Sections</div>
        {err && <p className="err-text">{err}</p>}
        {sections && (Object.keys(SECTION_LABELS) as (keyof SectionsSetting)[]).map((k) => (
          <div key={k} className="check" style={{ justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--line-2)' }}>
            <span>{SECTION_LABELS[k]} <span className="status">/{k}</span></span>
            <Switch checked={sections[k]} label={`Show ${SECTION_LABELS[k]}`} onChange={(v) => saveSections({ ...sections, [k]: v })} />
          </div>
        ))}
        <span className="hint">Off = hidden everywhere. Content is kept.</span>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="lbl">Featured post</div>
        {featured && (
          <>
            <label className="check"><input type="radio" name="feat" checked={featured.mode === 'latest'} onChange={() => saveFeatured({ mode: 'latest', entryId: null })} />Latest post</label>
            <label className="check"><input type="radio" name="feat" checked={featured.mode === 'manual'} onChange={() => saveFeatured({ mode: 'manual', entryId: featured.entryId ?? posts[0]?.id ?? null })} />Pin a post</label>
            {featured.mode === 'manual' && (
              <label className="field">Post
                <select className="select" value={featured.entryId ?? ''} onChange={(e) => saveFeatured({ mode: 'manual', entryId: e.target.value || null })}>
                  <option value="">Choose…</option>
                  {posts.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FooterSettings() {
  const [f, setF] = useState<FooterSetting | null>(null);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: FooterSetting }>('/api/admin/settings/footer').then((r) => setF(r.value)).catch((e) => setErr(errorText(e)));
  }, []);
  if (!f) return <p className={err ? 'err-text' : 'hint'}>{err || 'Loading…'}</p>;

  const up = (next: FooterSetting) => { setF(next); setDirty(true); };
  const badCount = f.columns.reduce((n, c) => n + c.links.filter((l) => !isSafeHref(l.url)).length, 0);
  const save = async () => {
    try {
      const r = await api.put<{ value: FooterSetting }>('/api/admin/settings/footer', f);
      setF(r.value);
      setDirty(false);
      toast('Footer published');
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid2">
        <label className="card field"><span className="lbl">About text</span>
          <textarea className="textarea" rows={3} maxLength={160} value={f.about} onChange={(e) => up({ ...f, about: e.target.value })} />
          <span className="hint">{f.about.length} / 160</span>
        </label>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field"><span className="lbl">Bottom line</span>
            <input className="input" maxLength={140} value={f.bottomLine} onChange={(e) => up({ ...f, bottomLine: e.target.value })} />
            <span className="hint">{'{year}'} = current year</span>
          </label>
          <label className="check"><input type="checkbox" checked={f.showRss} onChange={(e) => up({ ...f, showRss: e.target.checked })} />Always include an RSS link</label>
          <label className="check"><input type="checkbox" checked={f.showBuiltOn} onChange={(e) => up({ ...f, showBuiltOn: e.target.checked })} />Show “Built on Cloudflare”</label>
        </div>
      </div>
      <div className="grid2">
        {f.columns.map((c, ci) => (
          <div key={ci} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="field"><span className="lbl">Column {ci + 1} heading</span>
              <input className="input" maxLength={30} value={c.heading} onChange={(e) => { const cols = f.columns.slice(); cols[ci] = { ...c, heading: e.target.value }; up({ ...f, columns: cols }); }} />
            </label>
            {c.links.map((l, li) => {
              const bad = !isSafeHref(l.url);
              const setLink = (p: Partial<typeof l>) => { const cols = f.columns.slice(); const links = c.links.slice(); links[li] = { ...l, ...p }; cols[ci] = { ...c, links }; up({ ...f, columns: cols }); };
              return (
                <div key={li} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) auto', gap: 6 }}>
                    <input className="input" aria-label="Link label" maxLength={40} value={l.label} onChange={(e) => setLink({ label: e.target.value })} />
                    <input className={`input mono${bad ? ' bad' : ''}`} aria-label="Link URL" value={l.url} onChange={(e) => setLink({ url: e.target.value.trim() })} />
                    <button type="button" className="btn small" aria-label={`Remove ${l.label}`} onClick={() => { const cols = f.columns.slice(); cols[ci] = { ...c, links: c.links.filter((_, j) => j !== li) }; up({ ...f, columns: cols }); }}>✕</button>
                  </div>
                  {bad && <span className="err-text">Use https://…, a page on this site (/cv) or mailto:</span>}
                </div>
              );
            })}
            {c.links.length < 8 && <button type="button" className="btn small" onClick={() => { const cols = f.columns.slice(); cols[ci] = { ...c, links: [...c.links, { label: 'New link', url: 'https://' }] }; up({ ...f, columns: cols }); }}>+ Add link</button>}
            <button type="button" className="btn small danger" onClick={() => up({ ...f, columns: f.columns.filter((_, j) => j !== ci) })}>Remove column</button>
          </div>
        ))}
        {f.columns.length < 3 && (
          <button type="button" className="card btn" style={{ height: 'auto', minHeight: 120, justifyContent: 'center' }} onClick={() => up({ ...f, columns: [...f.columns, { heading: 'Links', links: [] }] })}>+ Add column</button>
        )}
      </div>
      <div className="actions">
        <span className={`status${badCount ? ' err' : ''}`}>{badCount ? `FIX ${badCount} LINK${badCount > 1 ? 'S' : ''} BEFORE PUBLISHING` : dirty ? 'UNSAVED CHANGES' : 'LIVE'}</span>
        <button type="button" className="btn primary" disabled={!dirty || badCount > 0} onClick={save}>Publish footer</button>
      </div>
    </div>
  );
}

function SiteSettings() {
  const [saved, setSaved] = useState<SiteSetting | null>(null);
  const [s, setS] = useState<SiteSetting | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [changes, setChanges] = useState<TopicChange[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialog = useDialog();

  useEffect(() => {
    api.get<{ value: SiteSetting }>('/api/admin/settings/site').then((r) => { setS(r.value); setSaved(r.value); }).catch(() => {});
    api.get<{ counts: Record<string, number> }>('/api/admin/topics').then((r) => setCounts(r.counts)).catch(() => {});
  }, []);
  if (!s || !saved) return <p className="hint">Loading…</p>;

  const dirty = JSON.stringify(s) !== JSON.stringify(saved) || changes.length > 0;
  // Counts follow pending renames so the chip keeps its number.
  const shown: Record<string, number> = { ...counts };
  for (const c of changes) if (c.to) shown[c.to] = (shown[c.to] ?? 0) + (counts[c.from] ?? 0);

  const record = (c: TopicChange) => {
    // Chain renames (A→B then B→C becomes A→C).
    const prior = changes.find((x) => x.to === c.from);
    setChanges(prior ? changes.map((x) => (x === prior ? { from: x.from, to: c.to } : x)) : [...changes, c]);
  };

  const remove = async (t: string) => {
    const origin = changes.find((x) => x.to === t)?.from ?? t;
    const n = counts[origin] ?? 0;
    if (n > 0) {
      const ok = await dialog.confirm({ title: `Remove “${t}”?`, body: `${n} post${n === 1 ? '' : 's'} will have no topic. You can set a new one in each post.`, confirmLabel: 'Remove', danger: true });
      if (!ok) return;
    }
    setS({ ...s, topics: s.topics.filter((x) => x !== t) });
    if (n > 0) record({ from: t, to: '' });
  };

  const save = async () => {
    setBusy(true);
    try {
      const effective = changes.filter((c) => c.from !== c.to);
      if (effective.length) await api.post('/api/admin/topics', { changes: effective });
      const r = await api.put<{ value: SiteSetting }>('/api/admin/settings/site', s);
      setS(r.value);
      setSaved(r.value);
      setChanges([]);
      const fresh = await api.get<{ counts: Record<string, number> }>('/api/admin/topics').catch(() => null);
      if (fresh) setCounts(fresh.counts);
      toast('Saved');
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };

  return (
    <section className="card" style={{ maxWidth: 760 }}>
      <div className="set-row">
        <div className="set-l"><b>Site name</b><span>Header, tab title, RSS</span></div>
        <input className="input" value={s.title} maxLength={60} aria-label="Site name" onChange={(e) => setS({ ...s, title: e.target.value })} />
      </div>
      <div className="set-row">
        <div className="set-l"><b>Tagline</b><span>Empty = section name</span></div>
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" value={s.tagline} maxLength={60} placeholder="journal, photos, cv…" aria-label="Tagline" onChange={(e) => setS({ ...s, tagline: e.target.value })} />
          <span className="brand-preview" aria-hidden="true"><b>{s.title || 'sxingxian'}</b><i>{s.tagline.trim() || 'journal'}</i></span>
        </div>
      </div>
      <div className="set-row">
        <div className="set-l"><b>Journal topics</b><span>Filters on the home page and journal</span></div>
        <TopicsEditor topics={s.topics} counts={shown} onRemove={(t) => void remove(t)}
          onChange={(topics, change) => { setS({ ...s, topics }); if (change) record(change); }} />
      </div>
      <div className="save-bar">
        {dirty && <span className="status">Unsaved changes</span>}
        {changes.some((c) => c.to) && <span className="hint">Renamed topics update their posts.</span>}
        <button type="button" className="btn primary" disabled={!dirty || busy || !s.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  );
}

function AdsSettings() {
  const [a, setA] = useState<AdsSetting | null>(null);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => {
    api.get<{ value: AdsSetting }>('/api/admin/settings/ads').then((r) => setA(r.value)).catch((e) => setErr(errorText(e)));
  }, []);
  if (!a) return <p className={err ? 'err-text' : 'hint'}>{err || 'Loading…'}</p>;

  const clientOk = a.client === '' || ADSENSE_CLIENT_RE.test(a.client.trim());
  const slotOk = (v: string) => v === '' || ADSENSE_SLOT_RE.test(v.trim());
  const save = async (next: AdsSetting) => {
    try {
      const r = await api.put<{ value: AdsSetting }>('/api/admin/settings/ads', next);
      setA(r.value);
      toast(r.value.enabled ? 'Ads are on' : 'Saved');
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div className="grid2">
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="check" style={{ justifyContent: 'space-between' }}>
          <span>Show ads</span>
          <Switch checked={a.enabled} label="Show ads" disabled={!ADSENSE_CLIENT_RE.test(a.client)} onChange={(v) => save({ ...a, enabled: v })} />
        </div>
        <label className="field">Publisher ID
          <input className={`input mono${clientOk ? '' : ' bad'}`} value={a.client} placeholder="ca-pub-0000000000000000" spellCheck={false} autoCapitalize="off"
            onChange={(e) => setA({ ...a, client: e.target.value.trim() })} />
        </label>
        <label className="field">Home page unit <span className="hint">Ad slot ID · optional</span>
          <input className={`input mono${slotOk(a.homeSlot) ? '' : ' bad'}`} value={a.homeSlot} inputMode="numeric" placeholder="1234567890" onChange={(e) => setA({ ...a, homeSlot: e.target.value.trim() })} />
        </label>
        <label className="field">End of posts unit <span className="hint">Ad slot ID · optional</span>
          <input className={`input mono${slotOk(a.articleSlot) ? '' : ' bad'}`} value={a.articleSlot} inputMode="numeric" placeholder="1234567890" onChange={(e) => setA({ ...a, articleSlot: e.target.value.trim() })} />
        </label>
        <div><button type="button" className="btn primary" disabled={!clientOk || !slotOk(a.homeSlot) || !slotOk(a.articleSlot)} onClick={() => save(a)}>Save</button></div>
      </section>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="lbl">Checklist</div>
        <dl className="facts">
          <dt>ads.txt</dt><dd>{ADSENSE_CLIENT_RE.test(a.client) ? <a href="/ads.txt" target="_blank" rel="noopener">Live ↗</a> : 'After you save a publisher ID'}</dd>
          <dt>Privacy</dt><dd><a href="/admin/pages/privacy">Write the Privacy page</a> (required by AdSense)</dd>
          <dt>EU / UK</dt><dd>Publish Google’s consent message in AdSense → Privacy &amp; messaging</dd>
          <dt>Auto ads</dt><dd>Optional, set in AdSense. The units above work without them.</dd>
          <dt>No ads</dt><dd>Admin, CV, About, Privacy</dd>
        </dl>
      </section>
    </div>
  );
}

function WatermarkPreview({ p }: { p: ProtectionSetting }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const w = c.width;
    const h = c.height;
    // A neutral stand-in photo: sky, horizon, ground.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#c9d3d6'); g.addColorStop(0.55, '#8d9a9c'); g.addColorStop(0.56, '#4d544f'); g.addColorStop(1, '#232623');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    void document.fonts.load('600 40px "Inter Variable"').catch(() => undefined).then(() => {
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (p.watermark) drawWatermark(ctx, w, h, p);
    });
  }, [p]);
  return <canvas ref={ref} width={960} height={640} style={{ width: '100%', height: 'auto', borderRadius: 10, display: 'block' }} aria-label="Watermark preview" role="img" />;
}

function PhotoSettings() {
  const [p, setP] = useState<ProtectionSetting | null>(null);
  const [saved, setSaved] = useState<ProtectionSetting | null>(null);
  const [status, setStatus] = useState<{ sig: string; total: number; pending: { id: string }[] } | null>(null);
  const [run, setRun] = useState<{ done: number; of: number; failed: number } | null>(null);
  const [err, setErr] = useState('');
  const toast = useToast();

  const loadStatus = () => api.get<{ sig: string; total: number; pending: { id: string }[] }>('/api/admin/media/watermark').then(setStatus).catch(() => {});
  useEffect(() => {
    api.get<{ value: ProtectionSetting }>('/api/admin/settings/protection').then((r) => { setP(r.value); setSaved(r.value); }).catch((e) => setErr(errorText(e)));
    void loadStatus();
  }, []);
  if (!p || !saved) return <p className={err ? 'err-text' : 'hint'}>{err || 'Loading…'}</p>;

  const dirty = JSON.stringify(p) !== JSON.stringify(saved);
  const save = async (next: ProtectionSetting) => {
    try {
      const r = await api.put<{ value: ProtectionSetting }>('/api/admin/settings/protection', next);
      setP(r.value);
      setSaved(r.value);
      toast('Saved');
      await loadStatus();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const applyAll = async () => {
    if (!status) return;
    const ids = status.pending.map((x) => x.id);
    setRun({ done: 0, of: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        await watermarkStored(ids[i], saved, status.sig);
      } catch {
        failed++;
      }
      setRun({ done: i + 1, of: ids.length, failed });
    }
    toast(failed ? `${ids.length - failed} watermarked, ${failed} failed` : 'All photos watermarked');
    setRun(null);
    await loadStatus();
  };

  const pending = status?.pending.length ?? 0;
  return (
    <div className="grid2">
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="check" style={{ justifyContent: 'space-between' }}>
          <span>Watermark photos</span>
          <Switch checked={p.watermark} label="Watermark photos" onChange={(v) => save({ ...p, watermark: v })} />
        </div>
        <WatermarkPreview p={p} />
        <label className="field">Text
          <input className="input" value={p.text} maxLength={60} onChange={(e) => setP({ ...p, text: e.target.value })} />
        </label>
        <div className="field">Position
          <div className="seg-row" role="radiogroup" aria-label="Position">
            {([['br', 'Bottom right'], ['bl', 'Bottom left'], ['center', 'Centre'], ['tiled', 'Tiled']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={p.position === v} className="btn small" onClick={() => setP({ ...p, position: v })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field">Size
          <div className="seg-row" role="radiogroup" aria-label="Size">
            {([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={p.size === v} className="btn small" onClick={() => setP({ ...p, size: v })}>{l}</button>
            ))}
          </div>
        </div>
        <label className="field">Opacity · {Math.round(p.opacity * 100)}%
          <input type="range" min={10} max={70} step={5} value={Math.round(p.opacity * 100)} onChange={(e) => setP({ ...p, opacity: Number(e.target.value) / 100 })} />
        </label>
        <div><button type="button" className="btn primary" disabled={!dirty || !p.text.trim()} onClick={() => save(p)}>Save</button></div>
      </section>

      <div className="stack">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="lbl">Photos</div>
          {status && (
            saved.watermark ? (
              pending === 0
                ? <span>All {status.total} photos are watermarked.</span>
                : <span>{pending} of {status.total} photos still show without a watermark.</span>
            ) : <span className="muted">Watermark is off. Originals are shown.</span>
          )}
          {saved.watermark && pending > 0 && !run && <div><button type="button" className="btn accent" onClick={applyAll}>Apply to {pending} photo{pending === 1 ? '' : 's'}</button></div>}
          {run && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="meter"><i style={{ width: `${(run.done / Math.max(1, run.of)) * 100}%`, background: 'var(--accent)' }} /></div>
              <span className="muted">{run.done} / {run.of}{run.failed ? ` · ${run.failed} failed` : ''}. Keep this tab open.</span>
            </div>
          )}
          <span className="muted">New uploads are watermarked automatically. Public copies are capped at 2560 px; originals stay private.</span>
        </section>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="check" style={{ justifyContent: 'space-between' }}>
            <span>Block saving</span>
            <Switch checked={p.blockSave} label="Block saving" onChange={(v) => save({ ...p, blockSave: v })} />
          </div>
          <span className="muted">Right-click, drag and long-press save are blocked. Image links can’t be opened on their own or shown on other sites. Screenshots can’t be stopped; the watermark covers those.</span>
        </section>
      </div>
    </div>
  );
}
