import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import MediaPicker from '../components/MediaPicker';
import { relTime, useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import Lightbox from '../components/Lightbox';
import type { MediaItem } from '../../lib/shared/types';

export default function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const dialog = useDialog();
  const [view, setView] = useState<number | null>(null);

  const load = () => api.get<{ media: MediaItem[] }>('/api/admin/media').then((r) => setItems(r.media)).catch((e) => setErr(errorText(e)));
  useEffect(() => { void load(); }, []);

  const remove = async (m: MediaItem) => {
    const ok = await dialog.confirm({ title: 'Delete this file?', body: 'Anywhere it’s used will show a broken image.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/admin/media/${m.id}`);
      setItems((xs) => xs?.filter((x) => x.id !== m.id) ?? null);
      toast('Deleted');
    } catch (e) {
      toast(errorText(e));
    }
  };

  const photos = (items ?? []).filter((m) => m.mime.startsWith('image/'));

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><b>Media</b></div>
        <div className="actions"><button type="button" className="btn primary" onClick={() => setOpen(true)}>Upload</button></div>
      </div>
      <div className="page">
        <h1>Media</h1>
        {err && <p className="err-text">{err}</p>}
        <div className="lib" style={{ marginTop: 18 }}>
          {items === null && <div className="empty">Loading…</div>}
          {items?.length === 0 && <div className="empty">No media yet.</div>}
          {items?.map((m) => (
            <div key={m.id} className="tile">
              {m.mime.startsWith('image/') ? (
                <button type="button" className="lib-open" aria-label={`View ${m.alt || m.filename}`} onClick={() => setView(photos.findIndex((x) => x.id === m.id))}>
                  <img src={`/media/${m.id}`} alt={m.alt} loading="lazy" />
                </button>
              ) : <div className="drop" style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>{m.provider === 'youtube' || m.provider === 'vimeo' ? `${m.provider} · ${m.embed_id}` : m.mime}</div>}
              <div className="cap"><span>{m.provider.toUpperCase()} · {relTime(m.created_at)}</span><button type="button" className="btn small danger" onClick={() => remove(m)} aria-label={`Delete ${m.filename}`}>✕</button></div>
            </div>
          ))}
        </div>
      </div>
      {view !== null && view >= 0 && photos.length > 0 && (
        <Lightbox items={photos.map((m) => ({ src: `/media/${m.id}`, alt: m.alt, caption: m.alt || m.filename }))} start={view} onClose={() => setView(null)} />
      )}
      {open && <MediaPicker imagesOnly={false} onClose={() => setOpen(false)} onPick={() => { setOpen(false); toast('Uploaded'); void load(); }} />}
    </>
  );
}
