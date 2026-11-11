// Settings, in six tabs. Every tab uses the same pattern: titled panels of labelled rows,
// switches that save at once, and a save bar for edits that need confirming.
import { useEffect, useRef, useState } from 'react';
import { clearLogoCache, drawWatermark, loadLogo, watermarkStored, type LogoImage } from '../watermark';
import { logoActive, watermarkHasContent } from '../../lib/shared/watermark';
import TopicsEditor, { type TopicChange } from '../components/TopicsEditor';
import FeaturedEditor from '../components/FeaturedEditor';
import { useMediaPicker } from '../components/useMediaPicker';
import SafeImg from '../components/SafeImg';
import { useDialog } from '../components/dialog';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { Loading, Page, Panel, Row, SaveBar, Segmented, ToggleRow } from '../components/kit';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE, isSafeHref } from '../../lib/shared/safe';
import { SECTION_LABELS, type TopicsSetting, type AdsSetting, type Entry, type FeaturedSetting, type FooterSetting, type ProtectionSetting, type SectionsSetting, type SiteSetting } from '../../lib/shared/types';

type Tab = 'home' | 'site' | 'topics' | 'footer' | 'photos' | 'ads';
const TABS: [Tab, string][] = [['home', 'Home'], ['site', 'Site'], ['topics', 'Topics'], ['footer', 'Footer'], ['photos', 'Photos'], ['ads', 'Ads']];

export default function Settings() {
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.slice(1) as Tab;
    return TABS.some(([t]) => t === h) ? h : 'home';
  });
  const pick = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `#${t}`); };
  return (
    <Page title="Settings" section="settings" here={tab === 'home' ? undefined : TABS.find(([t]) => t === tab)?.[1]} onSection={() => pick('home')} width="narrow">
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => pick(t)}>{l}</button>)}
      </div>
      {tab === 'home' && <HomeSettings />}
      {tab === 'site' && <SiteSettings />}
      {tab === 'topics' && <TopicSettings />}
      {tab === 'footer' && <FooterSettings />}
      {tab === 'photos' && <PhotoSettings />}
      {tab === 'ads' && <AdsSettings />}
    </Page>
  );
}

// ------------------------------------------------------------------ Home

function HomeSettings() {
  const [sections, setSections] = useState<SectionsSetting | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [posts, setPosts] = useState<Omit<Entry, 'body'>[]>([]);
  const [err, setErr] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: SectionsSetting }>('/api/admin/settings/sections').then((r) => setSections(r.value)).catch((e) => setErr(errorText(e)));
    api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
    api.get<{ entries: Omit<Entry, 'body'>[] }>('/api/admin/entries?kind=post').then((r) => setPosts(r.entries)).catch(() => {});
  }, []);
  if (!sections || !featured) return <Loading error={err} />;

  const saveSections = async (next: SectionsSetting) => {
    const prev = sections;
    setSections(next);
    try {
      await api.put('/api/admin/settings/sections', next);
      toast('Saved');
    } catch (e) {
      setSections(prev);
      toast(errorText(e));
    }
  };

  return (
    <>
      <FeaturedEditor value={featured} posts={posts} onSaved={setFeatured} />
      <Panel title="Sections" desc="Off hides a section everywhere. Its content is kept.">
        {(Object.keys(SECTION_LABELS) as (keyof SectionsSetting)[]).map((k) => (
          <ToggleRow key={k} label={SECTION_LABELS[k]} hint={`/${k}`} checked={sections[k]} onChange={(v) => saveSections({ ...sections, [k]: v })} />
        ))}
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ Site

function SiteSettings() {
  const [saved, setSaved] = useState<SiteSetting | null>(null);
  const [s, setS] = useState<SiteSetting | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { pickMedia, picker } = useMediaPicker();

  const [coverHost, setCoverHost] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ value: SiteSetting; coverHost: string | null }>('/api/admin/settings/site').then((r) => { setS(r.value); setSaved(r.value); setCoverHost(r.coverHost); }).catch(() => {});
  }, []);
  if (!s || !saved) return <Loading />;

  // The default cover saves straight away (like the switches), keeping unsaved name/tagline edits in the form.
  const setCover = async (id: string | null) => {
    try {
      const fresh = await api.get<{ value: SiteSetting }>('/api/admin/settings/site');
      const r = await api.put<{ value: SiteSetting; coverHost: string | null }>('/api/admin/settings/site', { ...fresh.value, defaultCoverId: id });
      setCoverHost(r.coverHost);
      setS({ ...s, defaultCoverId: r.value.defaultCoverId ?? null });
      setSaved({ ...saved, defaultCoverId: r.value.defaultCoverId ?? null });
      toast(id ? 'Default cover set' : 'Default cover removed');
    } catch (e) {
      toast(errorText(e));
    }
  };

  const dirty = s.title !== saved.title || s.tagline !== saved.tagline;

  const save = async () => {
    setBusy(true);
    try {
      // Re-read so story topics edited on the Topics tab since this tab opened aren't overwritten.
      const fresh = await api.get<{ value: SiteSetting }>('/api/admin/settings/site');
      const r = await api.put<{ value: SiteSetting }>('/api/admin/settings/site', { ...fresh.value, title: s.title, tagline: s.tagline });
      setS(r.value);
      setSaved(r.value);
      toast('Saved');
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };

  return (
    <Panel title="Site" desc="Name and tagline. Topics have their own tab.">
      <Row label="Site name" hint="Header, tab title, RSS" htmlFor="site-name">
        <input id="site-name" className="input" value={s.title} maxLength={60} onChange={(e) => setS({ ...s, title: e.target.value })} />
      </Row>
      <Row label="Tagline" hint="Empty = section name" htmlFor="site-tagline">
        <input id="site-tagline" className="input" value={s.tagline} maxLength={60} placeholder="stories, photos, cv…" onChange={(e) => setS({ ...s, tagline: e.target.value })} />
        <span className="brand-preview" aria-hidden="true"><b>{s.title || 'sxingxian'}</b><i>{s.tagline.trim() || 'stories'}</i></span>
      </Row>
      <Row label="Default cover" hint="Shown for any story, WordPress post, work or film without its own picture, and in link previews">
        <span className="cover-pick">
          {s.defaultCoverId
            ? <SafeImg className="cover-img" src={`/media/${s.defaultCoverId}`} alt="Current default cover" />
            : <span className="cover-none">None: posts without a picture show their topic</span>}
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn" onClick={async () => { const m = await pickMedia(); if (m) void setCover(m.id); }}>{s.defaultCoverId ? 'Change' : 'Choose photo'}</button>
            {s.defaultCoverId && <button type="button" className="btn" onClick={() => void setCover(null)}>Remove</button>}
          </span>
          {s.defaultCoverId && coverHost === 'nas' && (
            <span className="cover-warn" role="note">This photo is stored on the home NAS. If the NAS is off, it fails along with the pictures it stands in for. Upload it to Cloudflare R2 and choose it again.</span>
          )}
        </span>
      </Row>
      <SaveBar dirty={dirty} busy={busy} onSave={save} disabled={!s.title.trim()} />
      {picker}
    </Panel>
  );
}

// ------------------------------------------------------------------ Topics

type ListKey = 'stories' | keyof TopicsSetting;
type Lists = Record<ListKey, string[]>;
type Counts = Record<'post' | 'project' | 'gallery' | 'film', Record<string, number>>;
const LISTS: { key: ListKey; kind: keyof Counts; label: string; hint: string; noun: string }[] = [
  { key: 'stories', kind: 'post', label: 'Stories', hint: 'Filters on the home page and /story', noun: 'posts' },
  { key: 'work', kind: 'project', label: 'Work', hint: 'Filters on /work', noun: 'entries' },
  { key: 'photos', kind: 'gallery', label: 'Photos', hint: 'Filters on /photos', noun: 'galleries' },
  { key: 'film', kind: 'film', label: 'Film', hint: 'Filters on /film', noun: 'films' },
];
const NO_CHANGES: Record<ListKey, TopicChange[]> = { stories: [], work: [], photos: [], film: [] };

function TopicSettings() {
  const [saved, setSaved] = useState<Lists | null>(null);
  const [lists, setLists] = useState<Lists | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [changes, setChanges] = useState<Record<ListKey, TopicChange[]>>(NO_CHANGES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const dialog = useDialog();

  const load = async () => {
    const [site, topics, c] = await Promise.all([
      api.get<{ value: SiteSetting }>('/api/admin/settings/site'),
      api.get<{ value: TopicsSetting }>('/api/admin/settings/topics'),
      api.get<{ counts: Counts }>('/api/admin/topics'),
    ]);
    const next: Lists = { stories: site.value.topics, work: topics.value.work, photos: topics.value.photos, film: topics.value.film };
    setLists(next);
    setSaved(next);
    setCounts(c.counts);
  };
  useEffect(() => { load().catch((e) => setErr(errorText(e))); }, []);
  if (!lists || !saved || !counts) return <Loading error={err} />;

  const listDirty = (k: ListKey) => JSON.stringify(lists[k]) !== JSON.stringify(saved[k]) || changes[k].length > 0;
  const dirty = LISTS.some(({ key }) => listDirty(key));

  // Counts shown while editing: a renamed topic carries its entries with it.
  const shown = (k: ListKey, kind: keyof Counts) => {
    const base = counts[kind] ?? {};
    const out: Record<string, number> = { ...base };
    for (const c of changes[k]) if (c.to) out[c.to] = (out[c.to] ?? 0) + (base[c.from] ?? 0);
    return out;
  };

  const record = (k: ListKey, c: TopicChange) => {
    setChanges((all) => {
      const list = all[k];
      const prior = list.find((x) => x.to === c.from);
      return { ...all, [k]: prior ? list.map((x) => (x === prior ? { from: x.from, to: c.to } : x)) : [...list, c] };
    });
  };

  const remove = async (k: ListKey, kind: keyof Counts, noun: string, t: string) => {
    const origin = changes[k].find((x) => x.to === t)?.from ?? t;
    const n = counts[kind]?.[origin] ?? 0;
    if (n > 0) {
      const one = noun.replace(/(ies|s)$/, (m) => (m === 'ies' ? 'y' : ''));
      const ok = await dialog.confirm({ title: `Remove “${t}”?`, body: `It will be taken off ${n} ${n === 1 ? one : noun}.`, confirmLabel: 'Remove', danger: true });
      if (!ok) return;
    }
    setLists((l) => (l ? { ...l, [k]: l[k].filter((x) => x !== t) } : l));
    if (n > 0) record(k, { from: t, to: '' });
  };

  const save = async () => {
    setBusy(true);
    try {
      for (const { key, kind } of LISTS) {
        const effective = changes[key].filter((c) => c.from !== c.to);
        if (effective.length) await api.post('/api/admin/topics', { kind, changes: effective });
      }
      if (listDirty('stories')) {
        const site = await api.get<{ value: SiteSetting }>('/api/admin/settings/site');
        await api.put('/api/admin/settings/site', { ...site.value, topics: lists.stories });
      }
      if (listDirty('work') || listDirty('photos') || listDirty('film')) {
        await api.put('/api/admin/settings/topics', { work: lists.work, photos: lists.photos, film: lists.film });
      }
      setChanges(NO_CHANGES);
      await load();
      toast('Saved');
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };

  const renamed = LISTS.some(({ key }) => changes[key].some((c) => c.to));

  return (
    <Panel title="Topics" desc="One list per section. Entries pick up to 3 from their section’s list.">
      {LISTS.map(({ key, kind, label, hint, noun }) => (
        <Row key={key} label={label} hint={key === 'stories' ? hint : `${hint}${lists[key].length ? '' : ' · hidden while empty'}`}>
          <TopicsEditor topics={lists[key]} counts={shown(key, kind)} label={`${label} topics`} noun={noun}
            onRemove={(t) => void remove(key, kind, noun, t)}
            onChange={(topics, change) => { setLists((l) => (l ? { ...l, [key]: topics } : l)); if (change) record(key, change); }} />
        </Row>
      ))}
      <SaveBar dirty={dirty} busy={busy} onSave={save} note={renamed ? 'Renamed topics update their entries.' : undefined} />
    </Panel>
  );
}

// ------------------------------------------------------------------ Footer

function FooterSettings() {
  const [f, setF] = useState<FooterSetting | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: FooterSetting }>('/api/admin/settings/footer').then((r) => setF(r.value)).catch((e) => setErr(errorText(e)));
  }, []);
  if (!f) return <Loading error={err} />;

  const up = (next: FooterSetting) => { setF(next); setDirty(true); };
  const badCount = f.columns.reduce((n, c) => n + c.links.filter((l) => !isSafeHref(l.url)).length, 0);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ value: FooterSetting }>('/api/admin/settings/footer', f);
      setF(r.value);
      setDirty(false);
      toast('Footer published');
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };
  const setCol = (ci: number, col: FooterSetting['columns'][number]) => { const cols = f.columns.slice(); cols[ci] = col; up({ ...f, columns: cols }); };

  return (
    <>
      <Panel title="Text" desc="Shown at the bottom of every page.">
        <Row label="About" hint={`${f.about.length}/160`} htmlFor="ft-about">
          <textarea id="ft-about" className="textarea" rows={3} maxLength={160} value={f.about} onChange={(e) => up({ ...f, about: e.target.value })} />
        </Row>
        <Row label="Bottom line" hint="{year} = current year" htmlFor="ft-bottom">
          <input id="ft-bottom" className="input" maxLength={140} value={f.bottomLine} onChange={(e) => up({ ...f, bottomLine: e.target.value })} />
        </Row>
        <ToggleRow label="RSS link" hint="Always include one" checked={f.showRss} onChange={(v) => up({ ...f, showRss: v })} />
        <ToggleRow label="“Built on Cloudflare”" checked={f.showBuiltOn} onChange={(v) => up({ ...f, showBuiltOn: v })} />
      </Panel>

      <Panel title="Link columns" desc="Up to 3 columns of up to 8 links."
        actions={f.columns.length < 3 && <button type="button" className="btn small" onClick={() => up({ ...f, columns: [...f.columns, { heading: 'Links', links: [] }] })}>+ Column</button>}>
        {f.columns.map((c, ci) => (
          <Row key={ci} label={`Column ${ci + 1}`} hint="Heading, then links">
            <input className="input" aria-label={`Column ${ci + 1} heading`} maxLength={30} value={c.heading} placeholder="Heading" onChange={(e) => setCol(ci, { ...c, heading: e.target.value })} />
            {c.links.map((l, li) => {
              const bad = !isSafeHref(l.url);
              const setLink = (p: Partial<typeof l>) => { const links = c.links.slice(); links[li] = { ...l, ...p }; setCol(ci, { ...c, links }); };
              return (
                <div key={li} className="stack" style={{ gap: 3 }}>
                  <div className="input-row link-row">
                    <input className="input" aria-label="Link label" maxLength={40} value={l.label} onChange={(e) => setLink({ label: e.target.value })} />
                    <input className={`input mono${bad ? ' bad' : ''}`} aria-label="Link URL" value={l.url} onChange={(e) => setLink({ url: e.target.value.trim() })} />
                    <label className="check new-tab" title="Open in a new tab"><input type="checkbox" checked={!!l.newTab} onChange={(e) => setLink({ newTab: e.target.checked })} />New tab</label>
                    <button type="button" className="btn small" aria-label={`Remove ${l.label}`} onClick={() => setCol(ci, { ...c, links: c.links.filter((_, j) => j !== li) })}>✕</button>
                  </div>
                  {bad && <span className="err-text">Use https://, a page like /cv, or mailto:</span>}
                </div>
              );
            })}
            <div className="row">
              {c.links.length < 8 && <button type="button" className="btn small" onClick={() => setCol(ci, { ...c, links: [...c.links, { label: 'New link', url: 'https://' }] })}>+ Link</button>}
              <button type="button" className="btn small danger" onClick={() => up({ ...f, columns: f.columns.filter((_, j) => j !== ci) })}>Remove column</button>
            </div>
          </Row>
        ))}
        <SaveBar dirty={dirty} busy={busy} onSave={save} label="Publish footer" disabled={badCount > 0}
          error={badCount ? `Fix ${badCount} link${badCount > 1 ? 's' : ''} first` : undefined} />
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ Photos

function WatermarkPreview({ p, logo }: { p: ProtectionSetting; logo: LogoImage | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const w = c.width;
    const h = c.height;
    const paint = () => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#c9d3d6'); g.addColorStop(0.55, '#8d9a9c'); g.addColorStop(0.56, '#4d544f'); g.addColorStop(1, '#232623');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (p.watermark) drawWatermark(ctx, w, h, p, logo);
    };
    paint();
    void document.fonts.load('600 40px "Inter Variable"').catch(() => undefined).then(paint);
  }, [p, logo]);
  return <canvas ref={ref} width={960} height={600} className="wm-preview" role="img" aria-label="Watermark preview" />;
}

function LogoThumb({ img }: { img: LogoImage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const s = Math.min(c.width / img.width, c.height / img.height);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
  }, [img]);
  return <canvas ref={ref} width={160} height={64} role="img" aria-label="Current logo" />;
}

const LOGO_EDGE = 512; // logos are stored at most this many pixels on the long side
const LOGO_INPUT_MAX = 5 * 1024 * 1024;

/** Re-encode a picked image as a PNG ≤512 px. Drops metadata and anything that isn't pixels. */
async function logoToPng(file: File): Promise<Blob> {
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) throw new Error('Use a PNG, WebP or JPEG (export SVG logos as PNG)');
  if (file.size > LOGO_INPUT_MAX) throw new Error('That file is over 5 MB');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_EDGE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!out) throw new Error('Couldn’t read that image');
  if (out.size > 256 * 1024) throw new Error('Logo is still over 256 KB after resizing. Try a simpler image.');
  return out;
}

type LogoMode = 'original' | 'white' | 'off';

function PhotoSettings() {
  const [p, setP] = useState<ProtectionSetting | null>(null);
  const [saved, setSaved] = useState<ProtectionSetting | null>(null);
  const [status, setStatus] = useState<{ sig: string; total: number; pending: { id: string }[] } | null>(null);
  const [run, setRun] = useState<{ done: number; of: number; failed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [logoImg, setLogoImg] = useState<LogoImage | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const dialog = useDialog();

  const loadStatus = () => api.get<{ sig: string; total: number; pending: { id: string }[] }>('/api/admin/media/watermark').then(setStatus).catch(() => {});
  useEffect(() => {
    api.get<{ value: ProtectionSetting }>('/api/admin/settings/protection').then((r) => { setP(r.value); setSaved(r.value); }).catch((e) => setErr(errorText(e)));
    void loadStatus();
  }, []);
  const logoKey = p ? `${p.logoHash}:${p.logoTint}:${p.logo}` : '';
  useEffect(() => {
    if (!p || !logoActive(p)) { setLogoImg(null); return; }
    let live = true;
    loadLogo(p).then((img) => { if (live) setLogoImg(img); }).catch((e) => toast(errorText(e)));
    return () => { live = false; };
  }, [logoKey]);
  if (!p || !saved) return <Loading error={err} />;

  const look = (x: ProtectionSetting) => JSON.stringify([x.text, x.position, x.size, x.opacity, x.logo, x.logoTint]);
  const logoMode: LogoMode = !p.logo ? 'off' : p.logoTint;
  const setLogoMode = (m: LogoMode) => setP({ ...p, logo: m !== 'off', logoTint: m === 'off' ? p.logoTint : m });

  // Logo upload/removal is saved straight away (it's a file, not a form field).
  const afterLogo = async (value: ProtectionSetting) => {
    clearLogoCache();
    setSaved(value);
    setP((cur) => (cur ? { ...cur, logoHash: value.logoHash } : value));
    await loadStatus();
  };
  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      const png = await logoToPng(file);
      const res = await fetch('/api/admin/watermark-logo', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/png', 'X-Sx-Admin': '1' }, body: png,
      });
      const data = (await res.json().catch(() => ({}))) as { value?: ProtectionSetting; error?: string };
      if (!res.ok || !data.value) throw new Error(data.error ?? `Upload failed (${res.status})`);
      await afterLogo(data.value);
      toast('Logo uploaded');
    } catch (e) {
      toast(e instanceof Error ? e.message : errorText(e));
    }
    setLogoBusy(false);
  };
  const removeLogo = async () => {
    if (!(await dialog.confirm({ title: 'Remove the logo?', body: 'Watermarks will show the text only.', confirmLabel: 'Remove', danger: true }))) return;
    setLogoBusy(true);
    try {
      const r = await api.del<{ value: ProtectionSetting }>('/api/admin/watermark-logo');
      await afterLogo(r.value);
      toast('Logo removed');
    } catch (e) { toast(errorText(e)); }
    setLogoBusy(false);
  };
  const dirty = look(p) !== look(saved);
  const save = async (next: ProtectionSetting, quiet = false) => {
    setBusy(true);
    try {
      const r = await api.put<{ value: ProtectionSetting }>('/api/admin/settings/protection', next);
      setP(r.value);
      setSaved(r.value);
      if (!quiet) toast('Saved');
      await loadStatus();
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };
  // Switches save straight away, without unsaved look edits.
  const flip = (patch: Partial<ProtectionSetting>) => { setP({ ...p, ...patch }); void save({ ...saved, ...patch }); };

  const applyAll = async () => {
    if (!status) return;
    const ids = status.pending.map((x) => x.id);
    setRun({ done: 0, of: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try { await watermarkStored(ids[i], saved, status.sig); } catch { failed++; }
      setRun({ done: i + 1, of: ids.length, failed });
    }
    toast(failed ? `${ids.length - failed} watermarked, ${failed} failed` : 'All photos watermarked');
    setRun(null);
    await loadStatus();
  };

  const pending = status?.pending.length ?? 0;
  return (
    <>
      <Panel title="Watermark" desc="Baked into public copies (max 2560 px). Originals stay private.">
        <ToggleRow label="Watermark photos" hint="New uploads are watermarked automatically" checked={saved.watermark} onChange={(v) => flip({ watermark: v })} />
        <Row label="Preview"><WatermarkPreview p={{ ...p, watermark: true }} logo={logoImg} /></Row>
        <Row label="Logo" hint="Left of the text · PNG with transparency works best">
          <div className="logo-pick">
            <span className="logo-thumb">{saved.logoHash && logoImg ? <LogoThumb img={logoImg} /> : <em>No logo</em>}</span>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn small" disabled={logoBusy} onClick={() => fileRef.current?.click()}>{logoBusy ? 'Working…' : saved.logoHash ? 'Replace' : 'Upload logo'}</button>
              {saved.logoHash && <button type="button" className="btn small danger" disabled={logoBusy} onClick={removeLogo}>Remove</button>}
            </span>
            <input ref={fileRef} type="file" hidden accept="image/png,image/webp,image/jpeg"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadLogo(f); }} />
          </div>
        </Row>
        {saved.logoHash && (
          <Row label="Logo colour">
            <Segmented label="Logo colour" value={logoMode} onChange={setLogoMode} options={[['original', 'Original'], ['white', 'White'], ['off', 'Hidden']] as const} />
          </Row>
        )}
        <Row label="Text" hint={logoActive(p) ? 'Optional with a logo' : undefined} htmlFor="wm-text">
          <input id="wm-text" className="input" value={p.text} maxLength={60} onChange={(e) => setP({ ...p, text: e.target.value })} />
        </Row>
        <Row label="Position">
          <Segmented label="Position" value={p.position} onChange={(v) => setP({ ...p, position: v })}
            options={[['br', 'Bottom right'], ['bl', 'Bottom left'], ['center', 'Centre'], ['tiled', 'Tiled']] as const} />
        </Row>
        <Row label="Size">
          <Segmented label="Size" value={p.size} onChange={(v) => setP({ ...p, size: v })} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as const} />
        </Row>
        <Row label="Opacity" hint={`${Math.round(p.opacity * 100)}%`} htmlFor="wm-op">
          <input id="wm-op" type="range" min={10} max={70} step={5} value={Math.round(p.opacity * 100)} onChange={(e) => setP({ ...p, opacity: Number(e.target.value) / 100 })} />
        </Row>
        <SaveBar dirty={dirty} busy={busy} onSave={() => save(p)} disabled={!watermarkHasContent(p)}
          error={dirty && !watermarkHasContent(p) ? 'Add text or show the logo' : undefined}
          note={dirty && saved.watermark ? 'Existing photos will need Apply again.' : undefined} />
      </Panel>

      <Panel title="Existing photos">
        <Row label="Status" hint={status ? `${status.total} photos` : undefined}>
          {!saved.watermark ? <span className="muted">Watermark is off. Originals are shown.</span>
            : pending === 0 ? <span>All photos are watermarked.</span>
            : <span>{pending} still without a watermark.</span>}
          {saved.watermark && pending > 0 && !run && <div><button type="button" className="btn accent" onClick={applyAll}>Apply to {pending} photo{pending === 1 ? '' : 's'}</button></div>}
          {run && (
            <>
              <div className="meter"><i style={{ width: `${(run.done / Math.max(1, run.of)) * 100}%`, background: 'var(--accent)' }} /></div>
              <span className="muted">{run.done}/{run.of}{run.failed ? ` · ${run.failed} failed` : ''} · keep this tab open</span>
            </>
          )}
        </Row>
      </Panel>

      <Panel title="Saving">
        <ToggleRow label="Block saving" hint="Right-click, drag, long-press, direct links and hotlinking. Screenshots can’t be stopped."
          checked={saved.blockSave} onChange={(v) => flip({ blockSave: v })} />
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ Ads

function AdsSettings() {
  const [a, setA] = useState<AdsSetting | null>(null);
  const [saved, setSaved] = useState<AdsSetting | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => {
    api.get<{ value: AdsSetting }>('/api/admin/settings/ads').then((r) => { setA(r.value); setSaved(r.value); }).catch((e) => setErr(errorText(e)));
  }, []);
  if (!a || !saved) return <Loading error={err} />;

  const clientOk = a.client === '' || ADSENSE_CLIENT_RE.test(a.client);
  const slotOk = (v: string) => v === '' || ADSENSE_SLOT_RE.test(v);
  const ids = (x: AdsSetting) => JSON.stringify([x.client, x.homeSlot, x.articleSlot]);
  const dirty = ids(a) !== ids(saved);
  const save = async (next: AdsSetting) => {
    setBusy(true);
    try {
      const r = await api.put<{ value: AdsSetting }>('/api/admin/settings/ads', next);
      setA(r.value);
      setSaved(r.value);
      toast(r.value.enabled ? 'Ads are on' : 'Saved');
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };

  return (
    <>
      <Panel title="Google AdSense" desc="Never shown in the admin, CV, About or Privacy.">
        <ToggleRow label="Show ads" hint={ADSENSE_CLIENT_RE.test(saved.client) ? undefined : 'Save a publisher ID first'}
          checked={saved.enabled} disabled={!ADSENSE_CLIENT_RE.test(saved.client)} onChange={(v) => save({ ...saved, enabled: v })} />
        <Row label="Publisher ID" hint="ca-pub-…" htmlFor="ads-client">
          <input id="ads-client" className={`input mono${clientOk ? '' : ' bad'}`} value={a.client} placeholder="ca-pub-0000000000000000" spellCheck={false} autoCapitalize="off"
            onChange={(e) => setA({ ...a, client: e.target.value.trim() })} />
        </Row>
        <Row label="Home page unit" hint="Ad slot ID · optional" htmlFor="ads-home">
          <input id="ads-home" className={`input mono${slotOk(a.homeSlot) ? '' : ' bad'}`} value={a.homeSlot} inputMode="numeric" placeholder="1234567890" onChange={(e) => setA({ ...a, homeSlot: e.target.value.trim() })} />
        </Row>
        <Row label="End of posts unit" hint="Ad slot ID · optional" htmlFor="ads-article">
          <input id="ads-article" className={`input mono${slotOk(a.articleSlot) ? '' : ' bad'}`} value={a.articleSlot} inputMode="numeric" placeholder="1234567890" onChange={(e) => setA({ ...a, articleSlot: e.target.value.trim() })} />
        </Row>
        <SaveBar dirty={dirty} busy={busy} onSave={() => save({ ...a, enabled: saved.enabled && ADSENSE_CLIENT_RE.test(a.client) })}
          disabled={!clientOk || !slotOk(a.homeSlot) || !slotOk(a.articleSlot)} />
      </Panel>
      <Panel title="Checklist">
        <Row label="ads.txt">{ADSENSE_CLIENT_RE.test(saved.client) ? <a href="/ads.txt" target="_blank" rel="noopener">Live ↗</a> : <span className="muted">After you save a publisher ID</span>}</Row>
        <Row label="Privacy page"><a href="/admin/pages/privacy">Write it</a><span className="muted">Required by AdSense</span></Row>
        <Row label="EU / UK consent"><span className="muted">Publish Google’s message in AdSense → Privacy &amp; messaging</span></Row>
        <Row label="Auto ads"><span className="muted">Optional, set in AdSense</span></Row>
      </Panel>
    </>
  );
}
