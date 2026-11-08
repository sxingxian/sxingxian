import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { Switch, useToast } from '../components/ui';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE, isSafeHref } from '../../lib/shared/safe';
import { SECTION_LABELS, type Entry, type FeaturedSetting, type FooterSetting, type SectionsSetting, type SiteSetting, type AdsSetting } from '../../lib/shared/types';

type Tab = 'home' | 'footer' | 'site' | 'ads';

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
          <button type="button" role="tab" aria-selected={tab === 'ads'} onClick={() => setTab('ads')}>Ads</button>
        </div>
        {tab === 'home' && <HomeSettings />}
        {tab === 'footer' && <FooterSettings />}
        {tab === 'site' && <SiteSettings />}
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
  const [s, setS] = useState<SiteSetting | null>(null);
  const [topics, setTopics] = useState('');
  const toast = useToast();
  useEffect(() => {
    api.get<{ value: SiteSetting }>('/api/admin/settings/site').then((r) => { setS(r.value); setTopics(r.value.topics.join(', ')); }).catch(() => {});
  }, []);
  if (!s) return <p className="hint">Loading…</p>;
  const save = async () => {
    try {
      const value = { ...s, topics: topics.split(',').map((t) => t.trim()).filter(Boolean) };
      const r = await api.put<{ value: SiteSetting }>('/api/admin/settings/site', value);
      setS(r.value);
      toast('Saved');
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
      <label className="field">Site name<input className="input" value={s.title} maxLength={60} onChange={(e) => setS({ ...s, title: e.target.value })} /></label>
      <label className="field">Tagline <span className="hint">Empty = section name</span><input className="input" value={s.tagline} maxLength={60} onChange={(e) => setS({ ...s, tagline: e.target.value })} /></label>
      <label className="field">Topics (comma separated)<input className="input" value={topics} onChange={(e) => setTopics(e.target.value)} /></label>
      <div><button type="button" className="btn primary" onClick={save}>Save</button></div>
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
