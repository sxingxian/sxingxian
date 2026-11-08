import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../api';
import Editor from '../editor/Editor';
import MediaPicker from '../components/MediaPicker';
import { Switch, useToast } from '../components/ui';
import type { DocNode, MediaItem, Page, SectionsSetting } from '../../lib/shared/types';

const CV_TEMPLATE: DocNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'sxingxian' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Your role · Singapore' }] },
    {
      type: 'columns',
      attrs: { widths: [34, 66], gap: 'l', stackOnMobile: true, dividers: false },
      content: [
        { type: 'column', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Skills' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'TypeScript · Cloudflare · PostgreSQL' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Education' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Degree · University · Year' }] },
        ] },
        { type: 'column', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Experience' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Role · Company · 2024 — now' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What you owned, and the result it had' }] }] }] },
        ] },
      ],
    },
  ],
};

export default function PageEditor({ slug }: { slug: 'cv' | 'about' }) {
  const [page, setPage] = useState<Page | null>(null);
  const [sections, setSections] = useState<SectionsSetting | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [picker, setPicker] = useState<null | ((m: MediaItem | null) => void)>(null);
  const [sheet, setSheet] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setPage(null);
    api.get<{ page: Page }>(`/api/admin/pages/${slug}`)
      .then(({ page: p }) => setPage(slug === 'cv' && (!p.body.content || p.body.content.length === 0) ? { ...p, body: CV_TEMPLATE } : p))
      .catch((e) => setErr(errorText(e)));
    api.get<{ value: SectionsSetting }>('/api/admin/settings/sections').then((r) => setSections(r.value)).catch(() => {});
  }, [slug]);

  const save = useCallback(async () => {
    if (!page) return;
    setSaving(true);
    setErr('');
    try {
      await api.put(`/api/admin/pages/${slug}`, { title: page.title, body: page.body, noindex: page.noindex });
      setDirty(false);
      toast('Saved');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSaving(false);
    }
  }, [page, slug, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const pickMedia = useCallback(
    () => new Promise<{ id: string; alt: string } | null>((resolve) => {
      setPicker(() => (m: MediaItem | null) => { setPicker(null); resolve(m ? { id: m.id, alt: m.alt } : null); });
    }),
    [],
  );

  const toggleSection = async (on: boolean) => {
    if (!sections) return;
    const next = { ...sections, [slug]: on };
    try {
      const r = await api.put<{ value: SectionsSetting }>('/api/admin/settings/sections', next);
      setSections(r.value);
      toast(on ? `${slug === 'cv' ? 'CV' : 'About'} is on the site` : `${slug === 'cv' ? 'CV' : 'About'} hidden from the site`);
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (!page) return <div className="page"><p className={err ? 'err-text' : 'hint'}>{err || 'Loading…'}</p></div>;
  const label = slug === 'cv' ? 'CV' : 'About';

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><span>Pages</span><span>/</span><b>{label}</b></div>
        <div className="actions">
          <span className={`status${err ? ' err' : ''}`}>{err ? 'NOT SAVED' : saving ? 'SAVING…' : dirty ? 'UNSAVED CHANGES' : 'SAVED'}</span>
          {sections && <span className="check" style={{ fontSize: 13 }}>On the site <Switch checked={sections[slug]} label={`Show ${label} page`} onChange={toggleSection} /></span>}
          <a className="btn" href={`/${slug}`} target="_blank" rel="noopener">Preview ↗</a>
          <button type="button" className="btn publish-btn" onClick={() => setSheet(true)} aria-expanded={sheet}>Page…</button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>Save</button>
        </div>
      </div>
      {err && <div className="page" style={{ paddingBottom: 0 }}><p className="err-text" role="alert">{err}</p></div>}
      <div className="editor-layout">
        <div className="editor-main">
          <div className={`doc${slug === 'cv' ? ' sheet' : ''}`}>
            {slug === 'about' && (
              <input className="title-input" value={page.title} placeholder="About" aria-label="Page title" onChange={(e) => { setPage({ ...page, title: e.target.value }); setDirty(true); }} />
            )}
            <Editor key={slug} content={page.body} allowH1={slug === 'cv'} pickMedia={pickMedia} onChange={(body) => { setPage((p) => (p ? { ...p, body } : p)); setDirty(true); }} />
          </div>
        </div>
        {sheet && <button type="button" className="sheet-back phone-only" aria-label="Close page settings" onClick={() => setSheet(false)} />}
        <aside className={`editor-side${sheet ? ' open' : ''}`} aria-label="Page settings">
          <span className="grip" aria-hidden="true" />
          <div className="spread">
            <div className="lbl">Page</div>
            <button type="button" className="btn small sheet-close" onClick={() => setSheet(false)}>Done</button>
          </div>
          {slug === 'cv' && <span className="hint">“/2 columns” or “/3 columns” for layouts.</span>}
          <label className="check"><input type="checkbox" checked={page.noindex} onChange={(e) => { setPage({ ...page, noindex: e.target.checked }); setDirty(true); }} />Hide from search engines</label>
          {slug === 'cv' && <span className="hint">Public page: leave out phone and address.</span>}
        </aside>
      </div>
      {picker && <MediaPicker onPick={(m) => picker(m)} onClose={() => picker(null)} />}
    </>
  );
}
