// The Telegram part of the publishing panel: post this entry or not, the default message or its own, which
// image, a preview, and (once live) where it was posted. Shown only when a bot is connected and at least one
// channel takes this kind of entry. Options save by themselves.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { Segmented, ToggleRow } from './kit';
import SafeImg from './SafeImg';
import { useToast } from './ui';
import { CAPTION_MAX, markdownToTelegramHtml, TEXT_MAX, visibleLength } from '../../lib/shared/telegram-format';
import { whenLabel, type EntryState } from '../../lib/shared/state';

interface Options { announce: boolean; message: string | null; image: 'cover' | 'none' | string }
interface PostRecord { chat: string; status: 'sending' | 'sent' | 'failed'; attempts: number; messageId: number | null; error: string | null; at: string }
interface View {
  available: boolean;
  connected: boolean;
  options: Options;
  channels: { chat: string; title: string }[];
  posts: PostRecord[];
  preview: { html: string; imageId: string | null; button: string };
  defaultMessage: string;
  coverId: string | null;
}

/** A link to the post in Telegram: t.me/name/id for public channels, t.me/c/id/msg for private ones. */
function postLink(chat: string, id: number | null): string | null {
  if (!id) return null;
  if (chat.startsWith('@')) return `https://t.me/${chat.slice(1)}/${id}`;
  if (chat.startsWith('-100')) return `https://t.me/c/${chat.slice(4)}/${id}`;
  return null;
}

export default function TelegramSection({ entryId, state, refreshKey, pickMedia, onTargets }: {
  entryId: string | null;
  state: EntryState;
  /** The channels it will post to when it goes live ("a, b"), or null when it won't post. For the action bar. */
  onTargets?: (names: string | null) => void;
  /** Changes when the entry is published or unpublished: reload what was posted. */
  refreshKey: string;
  pickMedia: () => Promise<{ id: string } | null>;
}) {
  const [v, setV] = useState<View | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!entryId) return;
    try {
      const r = await api.get<View>(`/api/admin/entries/${entryId}/telegram`);
      setV(r);
      setText(r.options.message ?? r.defaultMessage);
    } catch { /* the section just stays hidden */ }
  }, [entryId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  // Just published: the posts go out right after, so look again shortly.
  useEffect(() => {
    if (state !== 'published' || !v || v.posts.length >= v.channels.length && !v.posts.some((p) => p.status === 'sending')) return;
    const t = setTimeout(() => void load(), 3000);
    return () => clearTimeout(t);
  }, [state, v, load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const targets = v && v.available && v.connected && v.channels.length && v.options.announce
    ? v.channels.map((c) => c.title || c.chat).join(', ') : null;
  useEffect(() => { onTargets?.(targets); }, [onTargets, targets]);

  if (!entryId || !v || !v.available || !v.connected || !v.channels.length) return null;

  const save = (o: Options, wait = 0) => {
    setV({ ...v, options: o });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.put<View>(`/api/admin/entries/${entryId}/telegram`, o);
        setV((cur) => (cur ? { ...r, options: cur.options } : r));
      } catch (e) {
        toast(errorText(e));
      }
    }, wait);
  };
  const o = v.options;
  const own = o.message !== null;
  const imageId = o.image === 'none' ? null : o.image === 'cover' ? v.coverId : o.image;
  const html = own ? markdownToTelegramHtml(text) : v.preview.html;
  const len = visibleLength(html);
  const limit = imageId ? CAPTION_MAX : TEXT_MAX;
  const names = v.channels.map((c) => c.title || c.chat).join(', ');
  const title = (chat: string) => v.channels.find((c) => c.chat === chat)?.title || chat;

  const retry = async (chat: string) => {
    setBusy(true);
    try { setV(await api.post<View>(`/api/admin/entries/${entryId}/telegram`, { retry: chat })); } catch (e) { toast(errorText(e)); }
    setBusy(false);
  };

  return (
    <section className="tg-section" aria-label="Telegram">
      <ToggleRow label="Post to Telegram" checked={o.announce} onChange={(announce) => save({ ...o, announce })}
        hint={state === 'published' && v.posts.length ? undefined : `When it goes live · ${names}`} />
      {v.posts.length > 0 && (
        <ul className="tg-posts">
          {v.posts.map((p) => {
            const link = postLink(p.chat, p.messageId);
            return (
              <li key={p.chat} className={`is-${p.status}`}>
                {p.status === 'sent' && <><span>Posted to <b>{title(p.chat)}</b></span><span className="hint">{whenLabel(p.at)}{link && <> · <a href={link} target="_blank" rel="noopener">Open in Telegram ↗</a></>}</span></>}
                {p.status === 'sending' && <span>Posting to <b>{title(p.chat)}</b>…</span>}
                {p.status === 'failed' && (
                  <>
                    <span>Couldn’t post to <b>{title(p.chat)}</b></span>
                    <span className="hint">{p.error}{p.attempts > 1 ? ` · tried ${p.attempts} times` : ''}</span>
                    <button type="button" className="btn small" disabled={busy} onClick={() => void retry(p.chat)}>Try again</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {o.announce && !(state === 'published' && v.posts.length >= v.channels.length) && (
        <>
          <Segmented label="Message" value={own ? 'own' : 'default'} options={[['default', 'Default message'], ['own', 'My own']] as const}
            onChange={(m) => { if (m === 'own') { setText(v.defaultMessage); save({ ...o, message: v.defaultMessage }); } else save({ ...o, message: null }); }} />
          {own && (
            <label className="kit-field">
              <span className="field-l">Message</span>
              <textarea className="input tg-text" rows={6} value={text} maxLength={4000}
                onChange={(e) => { setText(e.target.value); save({ ...o, message: e.target.value }, 700); }} />
              <span className={`hint${len > limit ? ' warn' : ''}`}>
                **bold**, _italic_, [link](https://…) · {len} of {limit} characters
                {imageId && len > CAPTION_MAX ? ' · too long for a caption: it’s posted without the image' : ''}
              </span>
            </label>
          )}
          <div className="tg-image">
            {imageId ? <SafeImg src={`/media/${imageId}`} alt="Image for the post" className="tg-thumb" /> : <span className="tg-thumb none">No image</span>}
            <Segmented label="Image" value={o.image === 'cover' || o.image === 'none' ? o.image : 'other'}
              options={[['cover', 'Cover'], ['other', 'Other…'], ['none', 'None']] as const}
              onChange={async (m) => {
                if (m === 'other') { const p = await pickMedia(); if (p) save({ ...o, image: p.id }); }
                else save({ ...o, image: m });
              }} />
          </div>
          {o.image === 'cover' && !v.coverId && <span className="hint">No cover yet: it’s posted as text.</span>}
          <button type="button" className="linklike tg-preview-toggle" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview the post'}</button>
          {preview && (
            <div className="tg-preview">
              {imageId && (!own || len <= CAPTION_MAX) && <SafeImg src={`/media/${imageId}`} alt="" />}
              {/* Built by markdownToTelegramHtml: escaped first, only b / i / code / http(s) links. */}
              <div className="tg-preview-text" dangerouslySetInnerHTML={{ __html: html.replace(/\n/g, '<br>') }} />
              <span className="tg-preview-btn">{v.preview.button} ↗</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
