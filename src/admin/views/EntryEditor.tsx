import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { useDialog } from '../components/dialog';
import DateTimePicker from '../components/DateTimePicker';
import Editor from '../editor/Editor';
import { useMediaPicker } from '../components/useMediaPicker';
import { useToast } from '../components/ui';
import { Field, Segmented, ToggleRow, TopBar } from '../components/kit';
import { KIND_SECTION } from '../nav';
import { slugify } from '../../lib/shared/safe';
import { KIND_PATH, TOPIC_LIST, TOPIC_LIST_LABEL, type DocNode, type Entry, type EntryEdits, type EntryKind, type FeaturedSetting, featuredIds, MAX_FEATURED, type MediaItem, type SiteSetting, type TopicsSetting } from '../../lib/shared/types';
import { entryState, untilLabel, whenLabel, type EntryState } from '../../lib/shared/state';
import SeriesField from '../components/SeriesField';
import SaveButton from '../components/SaveButton';
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
}

type Action = 'publish' | 'schedule' | 'unpublish' | 'update' | 'discard' | 'redate';
interface Saved { entry: Entry; edits: EntryEdits | null }

const fromSource = (kind: EntryKind, e: Pick<Entry, 'title' | 'slug' | 'dek' | 'topic' | 'topics' | 'body' | 'cover_media_id' | 'video_url' | 'meta'>): Draft => ({
  kind, title: e.title, slug: e.slug, dek: e.dek, topics: e.topics ?? (e.topic ? [e.topic] : []), body: e.body, cover_media_id: e.cover_media_id,
  video_url: e.video_url, meta: e.meta as Draft['meta'],
});

/** Tomorrow at 9:00 am local time: the first suggestion for a schedule. */
function tomorrowMorning(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0, 0).toISOString();
}

export default function EntryEditor({ id, kind: newKind, go }: { id: string | null; kind: EntryKind; go: (p: string) => void }) {
  const dialog = useDialog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [entryId, setEntryId] = useState<string | null>(id);
  const entryIdRef = useRef<string | null>(id);
  const [err, setErr] = useState('');
  const { pickMedia, pickFile, pickImages, picker } = useMediaPicker();
  const [site, setSite] = useState<SiteSetting | null>(null);
  const [lists, setLists] = useState<TopicsSetting | null>(null);
  const [featured, setFeatured] = useState<FeaturedSetting | null>(null);
  const [sheet, setSheet] = useState(false);
  // The entry as stored (its publishing state and live content), and whether a live entry has private edits.
  const [entry, setEntry] = useState<Entry | null>(null);
  const [hasEdits, setHasEdits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduleAt, setScheduleAt] = useState<string>(tomorrowMorning);
  const [now, setNow] = useState(() => Date.now());
  const slugTouched = useRef(!!id);
  const toast = useToast();

  useEffect(() => {
    api.get<{ value: SiteSetting }>('/api/admin/settings/site').then((r) => setSite(r.value)).catch(() => {});
    api.get<{ value: TopicsSetting }>('/api/admin/settings/topics').then((r) => setLists(r.value)).catch(() => {});
    api.get<{ value: FeaturedSetting }>('/api/admin/settings/featured').then((r) => setFeatured(r.value)).catch(() => {});
    if (id) {
      api.get<Saved>(`/api/admin/entries/${id}`)
        .then(({ entry: e, edits }) => {
          setEntry(e);
          setHasEdits(!!edits);
          // A live entry with private edits opens on the edits; the site keeps showing the live version.
          setDraft(fromSource(e.kind, edits ?? e));
        })
        .catch((e) => setErr(errorText(e)));
    } else {
      setDraft({ kind: newKind, title: '', slug: '', dek: '', topics: [], body: EMPTY, cover_media_id: null, video_url: '', meta: {} });
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
      ? await api.put<Saved>(`/api/admin/entries/${current}`, payload)
      : await api.post<Saved>('/api/admin/entries', payload);
    if (!current) {
      entryIdRef.current = res.entry.id;
      setEntryId(res.entry.id);
      window.history.replaceState(null, '', `/admin/edit/${res.entry.id}`);
    }
    setEntry(res.entry);
    setHasEdits(!!res.edits);
    const slug = res.edits?.slug ?? res.entry.slug;
    setDraft((cur) => (cur ? { ...cur, slug: cur.slug === d.slug ? slug : cur.slug } : cur));
    return JSON.stringify({ ...d, slug });
  }, []);
  const auto = useAutosave(draft ? JSON.stringify(draft) : null, persist);
  const { saveNow } = auto;

  // Keep "in 12 h" and Scheduled → Published current while the editor is open.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);


  // One publishing action. Saves what's typed first, so it acts on the latest content.
  const act = async (action: Action, at?: string) => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      if (!entryIdRef.current) await persist(JSON.stringify(draft)); // a brand-new entry: create it first
      else await auto.flushNow();
      const r = await api.post<Saved>(`/api/admin/entries/${entryIdRef.current}/state`, at ? { action, at } : { action });
      setEntry(r.entry);
      setHasEdits(!!r.edits);
      setNow(Date.now());
      if (action === 'discard') { auto.rebase(); setDraft(fromSource(r.entry.kind, r.entry)); }
      const msg: Record<Action, string> = {
        publish: 'Published', schedule: `Scheduled: goes live ${whenPhrase(r.entry.published_at ?? at ?? '', Date.now())}`, unpublish: 'Moved back to draft',
        update: 'Live story updated', discard: 'Edits discarded', redate: 'Date changed',
      };
      toast(msg[action]);
      if (action === 'publish' || action === 'schedule' || action === 'update') setSheet(false);
    } catch (e) {
      toast(errorText(e));
    }
    setBusy(false);
  };

  // Date pickers report every click; wait for a pause before acting on a new date.
  const dateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const actLater = (action: 'schedule' | 'redate', at: string | null) => {
    clearTimeout(dateTimer.current);
    if (at) dateTimer.current = setTimeout(() => void act(action, at), 700);
  };
  useEffect(() => () => clearTimeout(dateTimer.current), []);

  const unpublish = async () => {
    const ok = await dialog.confirm({ title: 'Move back to draft?', body: state === 'scheduled' ? 'It won’t go live at the scheduled time.' : 'It disappears from the site until you publish it again.', confirmLabel: 'Move to draft' });
    if (ok) void act('unpublish');
  };
  const discardEdits = async () => {
    const ok = await dialog.confirm({ title: 'Discard your edits?', body: 'The editor goes back to the live version. This can’t be undone.', confirmLabel: 'Discard', danger: true });
    if (ok) void act('discard');
  };

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
  const liveUrl = `${KIND_PATH[draft.kind]}/${entry?.slug ?? draft.slug}`;
  const state: EntryState = entryState(entry, now);
  const at = entry?.published_at ?? null;
  const edited = state === 'published' && hasEdits;
  const saveLabel = auto.state === 'saved' && !auto.dirty && edited ? 'Edits not live' : auto.label;

  return (
    <>
      <TopBar section={KIND_SECTION[draft.kind]} here={draft.title.trim() || 'Untitled'} actions={<>
          <span className={`status${auto.state === 'error' ? ' err' : ''}`} role="status" aria-live="polite">{saveLabel}</span>
          {state === 'published' && <a className="btn desktop-only" href={liveUrl} target="_blank" rel="noopener">View ↗</a>}
          {edited && <button type="button" className="btn primary desktop-only" onClick={() => void act('update')} disabled={busy}>Update</button>}
          {/* Phone: one button that names the state and opens the Publishing panel. */}
          <button type="button" className={`btn publish-btn state-btn is-${edited ? 'edited' : state}`} onClick={() => setSheet(true)} aria-expanded={sheet} aria-haspopup="dialog">
            {edited ? 'Update' : state === 'draft' ? 'Publish' : state === 'scheduled' ? <><ClockIcon />Scheduled</> : 'Published'}
          </button>
          <SaveButton auto={auto} />
        </>} />
      {(err || auto.error) && <div className="page" style={{ paddingBottom: 0 }}><div className="alert err" role="alert">{err || `Couldn’t save: ${auto.error}. Retrying automatically.`}</div></div>}
      <div className="editor-layout">
        <div className="editor-main">
          <div className="doc">
            <textarea className="title-input" rows={1} placeholder="Untitled" value={draft.title} aria-label="Title"
              onChange={(e) => patch({ title: e.target.value, ...(slugTouched.current || state !== 'draft' ? {} : { slug: slugify(e.target.value) }) })}
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
            <Editor content={draft.body} onChange={(body) => patch({ body })} pickMedia={pickMedia} pickFile={pickFile} pickImages={pickImages} />
          </div>
        </div>
        {sheet && <button type="button" className="sheet-back phone-only" aria-label="Close publishing" onClick={() => setSheet(false)} />}
        <aside className={`editor-side${sheet ? ' open' : ''}`} aria-label="Publishing">
          <span className="grip" aria-hidden="true" />
          <div className="side-head">
            <h2>Publishing</h2>
            <button type="button" className="btn small sheet-close" onClick={() => setSheet(false)}>Close</button>
          </div>
          {state === 'draft' && (
            <>
              <div className="state-card is-draft"><span className="pill">Draft</span><span>Only you can see it.</span></div>
              <Segmented label="When" value={when} onChange={setWhen} options={[['now', 'Now'], ['later', 'Schedule']] as const} />
              {when === 'later' && (
                <Field label="Goes live" hint="It goes live by itself at this time.">
                  <DateTimePicker value={scheduleAt} onChange={(iso) => { if (iso) setScheduleAt(iso); }} label="Goes live" />
                </Field>
              )}
              <button type="button" className="btn primary state-cta" disabled={busy}
                onClick={() => void (when === 'later' ? act('schedule', scheduleAt) : act('publish'))}>
                {when === 'later' ? 'Schedule' : 'Publish now'}
              </button>
            </>
          )}
          {state === 'scheduled' && at && (
            <>
              <div className="state-card is-scheduled">
                <span className="state-line"><span className="pill sched">Scheduled</span><b>{whenLabel(at, now)}</b></span>
                <span>Goes live by itself {untilLabel(at, now)}. Hidden until then.</span>
              </div>
              <Field label="Goes live">
                <DateTimePicker value={at} onChange={(iso) => actLater('schedule', iso)} label="Goes live" />
              </Field>
              <div className="state-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => void unpublish()}>Back to draft</button>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void act('publish')}>Publish now</button>
              </div>
            </>
          )}
          {state === 'published' && (
            <>
              <div className="state-card is-published">
                <span className="pill ok">Published</span>
                <span className="state-date">{at ? whenLabel(at, now) : ''}</span>
                <a href={liveUrl} target="_blank" rel="noopener">View ↗</a>
              </div>
              {edited && (
                <div className="state-edits" role="status">
                  <span>Your edits are saved but not live yet.</span>
                  <div className="state-actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => void discardEdits()}>Discard edits</button>
                    <button type="button" className="btn primary" disabled={busy} onClick={() => void act('update')}>Update live story</button>
                  </div>
                </div>
              )}
              <Field label="Date shown on it">
                <DateTimePicker value={at} onChange={(iso) => actLater('redate', iso)} label="Date shown on it" />
              </Field>
            </>
          )}
          <div className="side-toggles">
            {draft.kind === 'post' && (
              <ToggleRow label="Feature on home page" checked={isFeatured} onChange={(v) => void setFeature(v)}
                hint={isFeatured ? (state === 'published' ? `Featured · ${featIds.indexOf(entryId!) + 1} of ${featIds.length}` : state === 'scheduled' && at ? `Joins the carousel ${whenPhrase(at, now)}` : 'Shows once it’s published') : undefined} />
            )}
          </div>
          {draft.kind === 'post' && <SeriesField entryId={entryId} onManage={() => go('/admin/series')} />}
          <Field label="URL slug" hint={state === 'published' && draft.slug !== entry?.slug ? `Live: ${liveUrl} · changes with Update` : liveUrl} htmlFor="ed-slug">
            <input id="ed-slug" className="input mono" value={draft.slug} onChange={(e) => { slugTouched.current = true; patch({ slug: slugify(e.target.value) }); }} />
          </Field>
          {state === 'published' && <button type="button" className="btn side-unpublish" disabled={busy} onClick={() => void unpublish()}>Unpublish (back to draft)</button>}
          {entryId && <button type="button" className="btn danger side-danger" onClick={remove}>Delete entry</button>}
        </aside>
      </div>
      {picker}
    </>
  );
}

/** "today, 11:00 pm" · "tomorrow, 9:00 am" · "on Thu 12 Nov, 9:00 am", to follow a verb. */
function whenPhrase(iso: string, now: number): string {
  const w = whenLabel(iso, now);
  return /^(Today|Tomorrow|Yesterday)/.test(w) ? w[0].toLowerCase() + w.slice(1) : `on ${w}`;
}

function ClockIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
}
