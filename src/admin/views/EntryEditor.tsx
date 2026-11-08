import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import Editor from '../editor/Editor';
import MediaPicker from '../components/MediaPicker';
import { Switch, useToast } from '../components/ui';
import { slugify } from '../../lib/shared/safe';
import { KIND_LABELS, KIND_PATH, type DocNode, type Entry, type EntryKind, type FeaturedSetting, type MediaItem, type SiteSetting } from '../../lib/shared/types';

const EMPTY: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

interface Draft {
  kind: EntryKind;
  title: string;
  slug: string;
  dek: string;
  topic: string;
  body: DocNode;
  cover_media_id: string | null;
  video_url: string;
  meta: Record<string, string | number | boolean>;
  status: 'draft' | 'published';
  is_public: boolean;
  published_at: string | null;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export default function EntryEditor({ id, kind: newKind, go }: { id: string | null; kind: EntryKind; go: (p: string) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [entryId, setEntryId] = useState<string | null>(id);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [picker, setPicker] = useState<null | ((m: MediaItem | null) => void)>(null);
  const [site, setSite] = useState<SiteSetting | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const slugTouched = useRef(!!id);
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: SiteSetting }>('/api/admin/settings/site').then((r) => setSite(r.value)).catch(() => {});
    api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
    if (id) {
      api.get<{ entry: Entry }>(`/api/admin/entries/${id}`)
        .then(({ entry: e }) => setDraft({
          kind: e.kind, title: e.title, slug: e.slug, dek: e.dek, topic: e.topic, body: e.body, cover_media_id: e.cover_media_id,
          video_url: e.video_url, meta: e.meta as Draft['meta'], status: e.status, is_public: e.is_public, published_at: e.published_at,
        }))
        .catch((e) => setErr(errorText(e)));
    } else {
      setDraft({ kind: newKind, title: '', slug: '', dek: '', topic: '', body: EMPTY, cover_media_id: null, video_url: '', meta: {}, status: 'draft', is_public: false, published_at: null });
    }
  }, [id, newKind]);

  const patch = useCallback((p: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setErr('');
    const payload = { ...draft, title: draft.title.trim() || 'Untitled', slug: draft.slug || slugify(draft.title || 'untitled') };
    try {
      const res = entryId
        ? await api.put<{ entry: Entry }>(`/api/admin/entries/${entryId}`, payload)
        : await api.post<{ entry: Entry }>('/api/admin/entries', payload);
      setDraft((d) => (d ? { ...d, slug: res.entry.slug, published_at: res.entry.published_at } : d));
      setDirty(false);
      toast('Saved');
      if (!entryId) {
        setEntryId(res.entry.id);
        window.history.replaceState(null, '', `/admin/edit/${res.entry.id}`);
      }
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSaving(false);
    }
  }, [draft, entryId, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const pickMedia = useCallback(
    () => new Promise<{ id: string; alt: string } | null>((resolve) => {
      setPicker(() => (m: MediaItem | null) => { setPicker(null); resolve(m ? { id: m.id, alt: m.alt } : null); });
    }),
    [],
  );

  const remove = async () => {
    if (!entryId || !window.confirm('Delete this entry permanently?')) return;
    try {
      await api.del(`/api/admin/entries/${entryId}`);
      setDirty(false);
      go(`/admin/${draft?.kind === 'post' ? 'journal' : draft?.kind === 'project' ? 'work' : draft?.kind === 'gallery' ? 'photos' : 'film'}`);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const setFeature = async (on: boolean) => {
    if (!entryId) return toast('Save the post first');
    const value: FeaturedSetting = on ? { mode: 'manual', entryId } : { mode: 'latest', entryId: null };
    try {
      const r = await api.put<{ value: FeaturedSetting }>('/api/admin/settings/featured', value);
      setFeatured(r.value);
      toast(on ? 'Featured on the home page' : 'Home page shows the latest post');
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (err && !draft) return <div className="page"><p className="err-text">{err}</p></div>;
  if (!draft) return <div className="page"><p className="hint">Loading…</p></div>;

  const isFeatured = featured?.mode === 'manual' && featured.entryId === entryId;
  const liveUrl = `${KIND_PATH[draft.kind]}/${draft.slug}`;

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><span>{KIND_LABELS[draft.kind]}</span><span>/</span><b>{draft.title || 'Untitled'}</b></div>
        <div className="actions">
          <span className={`status${err ? ' err' : ''}`}>{err ? 'NOT SAVED' : saving ? 'SAVING…' : dirty ? 'UNSAVED CHANGES' : 'SAVED'}</span>
          {entryId && draft.status === 'published' && draft.is_public && <a className="btn" href={liveUrl} target="_blank" rel="noopener">View ↗</a>}
          <button type="button" className="btn primary" onClick={save} disabled={saving}>Save</button>
        </div>
      </div>
      {err && <div className="page" style={{ paddingBottom: 0 }}><p className="err-text" role="alert">{err}</p></div>}
      <div className="editor-layout">
        <div className="editor-main">
          <div className="doc">
            <textarea className="title-input" rows={1} placeholder="Untitled" value={draft.title} aria-label="Title"
              onChange={(e) => patch({ title: e.target.value, ...(slugTouched.current ? {} : { slug: slugify(e.target.value) }) })}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
            <textarea className="dek-input" rows={1} placeholder="A one-line summary shown in lists…" value={draft.dek} aria-label="Summary"
              onChange={(e) => patch({ dek: e.target.value })}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
            <div className="props">
              <label className="prop"><span>Topic</span>
                {draft.kind === 'post' && site ? (
                  <select className="select" value={draft.topic} onChange={(e) => patch({ topic: e.target.value })}>
                    <option value="">None</option>
                    {site.topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                ) : (
                  <input className="input" value={draft.topic} maxLength={40} onChange={(e) => patch({ topic: e.target.value })} placeholder="e.g. Infrastructure" />
                )}
              </label>
              <div className="prop"><span>Cover image</span>
                <span className="cover-pick">
                  {draft.cover_media_id && <img src={`/media/${draft.cover_media_id}`} alt="" />}
                  <button type="button" className="btn small" onClick={async () => { const m = await pickMedia(); if (m) patch({ cover_media_id: m.id }); }}>{draft.cover_media_id ? 'Change' : 'Choose'}</button>
                  {draft.cover_media_id && <button type="button" className="btn small danger" onClick={() => patch({ cover_media_id: null })}>Remove</button>}
                </span>
              </div>
              {draft.kind === 'film' && (
                <label className="prop"><span>Video link</span><input className="input" value={draft.video_url} onChange={(e) => patch({ video_url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>
              )}
            </div>
            <Editor content={draft.body} onChange={(body) => patch({ body })} pickMedia={pickMedia} />
          </div>
        </div>
        <aside className="editor-side" aria-label="Publishing">
          <div className="lbl">Publishing</div>
          <label className="field">Status
            <select className="select" value={draft.status} onChange={(e) => patch({ status: e.target.value as Draft['status'], ...(e.target.value === 'draft' ? {} : {}) })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
          <div className="check" style={{ justifyContent: 'space-between' }}>
            <span>Show publicly</span>
            <Switch checked={draft.is_public} label="Show publicly" onChange={(v) => patch({ is_public: v })} />
          </div>
          {draft.is_public && draft.status === 'draft' && <span className="hint">It goes live once the status is Published.</span>}
          <label className="field">Publish date
            <input className="input" type="datetime-local" value={toLocalInput(draft.published_at)} onChange={(e) => patch({ published_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            <span className="hint">A future date schedules it. Empty = when you publish.</span>
          </label>
          <label className="field">URL slug
            <input className="input mono" value={draft.slug} onChange={(e) => { slugTouched.current = true; patch({ slug: slugify(e.target.value) }); }} />
            <span className="hint">{liveUrl}</span>
          </label>
          {draft.kind === 'post' && (
            <div className="check" style={{ justifyContent: 'space-between' }}>
              <span>Feature on home page</span>
              <Switch checked={isFeatured} label="Feature on home page" onChange={setFeature} />
            </div>
          )}
          {draft.kind === 'post' && <span className="hint">{isFeatured ? 'Pinned as the featured post.' : 'When nothing is pinned, the latest post is featured.'}</span>}
          {entryId && <button type="button" className="btn danger" style={{ marginTop: 'auto' }} onClick={remove}>Delete entry</button>}
        </aside>
      </div>
      {picker && <MediaPicker onPick={(m) => picker(m)} onClose={() => picker(null)} />}
    </>
  );
}
