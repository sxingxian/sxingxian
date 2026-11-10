import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { useDialog } from '../components/dialog';
import DateTimePicker from '../components/DateTimePicker';
import Editor from '../editor/Editor';
import MediaPicker, { type PickerAccept } from '../components/MediaPicker';
import { useToast } from '../components/ui';
import { Field, Segmented, ToggleRow, TopBar } from '../components/kit';
import { KIND_SECTION } from '../nav';
import { slugify } from '../../lib/shared/safe';
import { KIND_PATH, TOPIC_LIST, TOPIC_LIST_LABEL, type DocNode, type Entry, type EntryKind, type FeaturedSetting, featuredIds, MAX_FEATURED, type MediaItem, type SiteSetting, type TopicsSetting } from '../../lib/shared/types';
import SeriesField from '../components/SeriesField';
import TopicsPicker from '../components/TopicsPicker';
import SafeImg from '../components/SafeImg';
import { useAutosave } from '../autosave';

const EMPTY: DocNode = { type: 'doc', content: [{ type: 'paragraph' }] };

interface Draft {
  kind: EntryKind;
  title: string;
  slug: string;
  dek: string;
  topics: string[];
  body: DocNode;
  cover_media_id: string | null;
  video_url: string;
  meta: Record<string, string | number | boolean>;
  status: 'draft' | 'published';
  is_public: boolean;
  published_at: string | null;
}

export default function EntryEditor({ id, kind: newKind, go }: { id: string | null; kind: EntryKind; go: (p: string) => void }) {
  const dialog = useDialog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [entryId, setEntryId] = useState<string | null>(id);
  const entryIdRef = useRef<string | null>(id);
  const [err, setErr] = useState('');
  const [picker, setPicker] = useState<null | ((m: MediaItem | null) => void)>(null);
  const [pickerAccept, setPickerAccept] = useState<PickerAccept>('images');
  const [site, setSite] = useState<SiteSetting | null>(null);
  const [lists, setLists] = useState<TopicsSetting | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [sheet, setSheet] = useState(false);
  const slugTouched = useRef(!!id);
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: SiteSetting }>('/api/admin/settings/site').then((r) => setSite(r.value)).catch(() => {});
    api.get<{ value: TopicsSetting }>('/api/admin/settings/topics').then((r) => setLists(r.value)).catch(() => {});
    api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
    if (id) {
      api.get<{ entry: Entry }>(`/api/admin/entries/${id}`)
        .then(({ entry: e }) => setDraft({
          kind: e.kind, title: e.title, slug: e.slug, dek: e.dek, topics: e.topics ?? (e.topic ? [e.topic] : []), body: e.body, cover_media_id: e.cover_media_id,
          video_url: e.video_url, meta: e.meta as Draft['meta'], status: e.status, is_public: e.is_public, published_at: e.published_at,
        }))
        .catch((e) => setErr(errorText(e)));
    } else {
      setDraft({ kind: newKind, title: '', slug: '', dek: '', topics: [], body: EMPTY, cover_media_id: null, video_url: '', meta: {}, status: 'draft', is_public: false, published_at: null });
    }
  }, [id, newKind]);

  const patch = useCallback((p: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }, []);

  // Autosave: the snapshot is the whole draft; a new entry is created on its first save.
  const persist = useCallback(async (snap: string) => {
    const d = JSON.parse(snap) as Draft;
    const payload = { ...d, topic: d.topics[0] ?? '', title: d.title.trim() || 'Untitled', slug: d.slug || slugify(d.title || 'untitled') };
    const current = entryIdRef.current;
    const res = current
      ? await api.put<{ entry: Entry }>(`/api/admin/entries/${current}`, payload)
      : await api.post<{ entry: Entry }>('/api/admin/entries', payload);
    if (!current) {
      entryIdRef.current = res.entry.id;
      setEntryId(res.entry.id);
      window.history.replaceState(null, '', `/admin/edit/${res.entry.id}`);
    }
    // The server may adjust the slug (to keep it unique) and sets the publish date on first publish.
    setDraft((cur) => (cur ? { ...cur, slug: cur.slug === d.slug ? res.entry.slug : cur.slug, published_at: cur.published_at === d.published_at ? res.entry.published_at : cur.published_at } : cur));
    return JSON.stringify({ ...d, slug: res.entry.slug, published_at: res.entry.published_at });
  }, []);
  const auto = useAutosave(draft ? JSON.stringify(draft) : null, persist);
  const { saveNow } = auto;
  const patchNow = useCallback((p: Partial<Draft>) => { patch(p); saveNow(); }, [patch, saveNow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  const pickMedia = useCallback(
    () => new Promise<{ id: string; alt: string } | null>((resolve) => {
      setPickerAccept('images');
      setPicker(() => (m: MediaItem | null) => { setPicker(null); resolve(m ? { id: m.id, alt: m.alt } : null); });
    }),
    [],
  );
  const pickFile = useCallback(
    (kind: 'pdf' | 'file') => new Promise<{ id: string; name: string; mime: string; bytes: number } | null>((resolve) => {
      setPickerAccept(kind === 'pdf' ? 'pdf' : 'files');
      setPicker(() => (m: MediaItem | null) => { setPicker(null); resolve(m ? { id: m.id, name: m.filename, mime: m.mime, bytes: Number(m.bytes) || 0 } : null); });
    }),
    [],
  );

  const remove = async () => {
    if (!entryId) return;
    const ok = await dialog.confirm({ title: 'Delete this entry?', body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      auto.discard();
      await api.del(`/api/admin/entries/${entryId}`);
      go(`/admin/${draft?.kind === 'post' ? 'stories' : draft?.kind === 'project' ? 'work' : draft?.kind === 'gallery' ? 'photos' : 'film'}`);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const setFeature = async (on: boolean) => {
    if (!entryId) return toast('Save the post first');
    try {
      // Re-read so stories featured elsewhere since this editor opened are kept.
      const cur = (await api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured')).value;
      const ids = featuredIds(cur).filter((x) => x !== entryId);
      if (on && ids.length >= MAX_FEATURED) { toast(`Up to ${MAX_FEATURED} featured stories: remove one in Settings → Home`); return; }
      const r = await api.put<{ value: FeaturedSetting }>('/api/admin/settings/featured', { entryIds: on ? [...ids, entryId] : ids, order: cur.order === 'custom' ? 'custom' : 'date' });
      setFeatured(r.value);
      toast(on ? 'Featured on the home page' : 'No longer featured');
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (err && !draft) return <div className="page"><p className="err-text">{err}</p></div>;
  if (!draft) return <div className="page"><p className="hint">Loading…</p></div>;

  const featIds = featuredIds(featured);
  const isFeatured = !!entryId && featIds.includes(entryId);
  const liveUrl = `${KIND_PATH[draft.kind]}/${draft.slug}`;

  return (
    <>
      <TopBar section={KIND_SECTION[draft.kind]} here={draft.title.trim() || 'Untitled'} actions={<>
          <span className={`status${auto.state === 'error' ? ' err' : ''}`} role="status" aria-live="polite">{auto.label}</span>
          {entryId && draft.status === 'published' && draft.is_public && <a className="btn" href={liveUrl} target="_blank" rel="noopener">View ↗</a>}
          <button type="button" className="btn publish-btn" onClick={() => setSheet(true)} aria-expanded={sheet}>Publish…</button>
          <button type="button" className="btn primary" onClick={saveNow} disabled={!auto.dirty && auto.state !== 'error'} title="Changes save automatically · Ctrl/⌘ S saves now">Save</button>
        </>} />
      {(err || auto.error) && <div className="page" style={{ paddingBottom: 0 }}><div className="alert err" role="alert">{err || `Couldn’t save: ${auto.error}. Retrying automatically.`}</div></div>}
      <div className="editor-layout">
        <div className="editor-main">
          <div className="doc">
            <textarea className="title-input" rows={1} placeholder="Untitled" value={draft.title} aria-label="Title"
              onChange={(e) => patch({ title: e.target.value, ...(slugTouched.current || draft.status === 'published' ? {} : { slug: slugify(e.target.value) }) })}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
            <textarea className="dek-input" rows={1} placeholder="Summary" value={draft.dek} aria-label="Summary"
              onChange={(e) => patch({ dek: e.target.value })}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }} />
            <div className="props">
              <div className="prop prop-topics"><span>Topics</span>
                <TopicsPicker value={draft.topics} listName={TOPIC_LIST_LABEL[TOPIC_LIST[draft.kind]]}
                  options={TOPIC_LIST[draft.kind] === 'stories' ? (site?.topics ?? null) : (lists ? lists[TOPIC_LIST[draft.kind] as keyof TopicsSetting] : null)}
                  onChange={(topics) => patch({ topics })}
                  onManage={() => go('/admin/settings#topics')} />
              </div>
              <div className="prop"><span>Cover image</span>
                <span className="cover-pick">
                  {draft.cover_media_id && <SafeImg src={`/media/${draft.cover_media_id}`} alt="" />}
                  <button type="button" className="btn small" onClick={async () => { const m = await pickMedia(); if (m) patch({ cover_media_id: m.id }); }}>{draft.cover_media_id ? 'Change' : 'Choose'}</button>
                  {draft.cover_media_id && <button type="button" className="btn small danger" onClick={() => patch({ cover_media_id: null })}>Remove</button>}
                </span>
              </div>
              {draft.kind === 'film' && (
                <label className="prop"><span>Video link</span><input className="input" value={draft.video_url} onChange={(e) => patch({ video_url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>
              )}
            </div>
            <Editor content={draft.body} onChange={(body) => patch({ body })} pickMedia={pickMedia} pickFile={pickFile} />
          </div>
        </div>
        {sheet && <button type="button" className="sheet-back phone-only" aria-label="Close publishing" onClick={() => setSheet(false)} />}
        <aside className={`editor-side${sheet ? ' open' : ''}`} aria-label="Publishing">
          <span className="grip" aria-hidden="true" />
          <div className="side-head">
            <h2>Publishing</h2>
            <button type="button" className="btn small sheet-close" onClick={() => setSheet(false)}>Done</button>
          </div>
          <Field label="Status" hint={draft.status === 'draft' ? 'Only you can see drafts.' : undefined}>
            <Segmented label="Status" value={draft.status} onChange={(v) => patchNow({ status: v })} options={[['draft', 'Draft'], ['published', 'Published']] as const} />
          </Field>
          <div className="side-toggles">
            <ToggleRow label="Show publicly" hint={draft.is_public && draft.status === 'draft' ? 'Live once published' : undefined} checked={draft.is_public} onChange={(v) => patchNow({ is_public: v })} />
            {draft.kind === 'post' && (
              <ToggleRow label="Feature on home page" hint={isFeatured ? `Featured · ${featIds.indexOf(entryId!) + 1} of ${featIds.length}` : undefined} checked={isFeatured} onChange={(v) => void setFeature(v)} />
            )}
          </div>
          {draft.kind === 'post' && <SeriesField entryId={entryId} onManage={() => go('/admin/series')} />}
          <Field label="Publish date" hint="Future date = scheduled.">
            <DateTimePicker value={draft.published_at} onChange={(iso) => patch({ published_at: iso })} />
          </Field>
          <Field label="URL slug" hint={liveUrl} htmlFor="ed-slug">
            <input id="ed-slug" className="input mono" value={draft.slug} onChange={(e) => { slugTouched.current = true; patch({ slug: slugify(e.target.value) }); }} />
          </Field>
          {entryId && <button type="button" className="btn danger side-danger" onClick={remove}>Delete entry</button>}
        </aside>
      </div>
      {picker && <MediaPicker accept={pickerAccept} onPick={(m) => picker(m)} onClose={() => picker(null)} />}
    </>
  );
}
