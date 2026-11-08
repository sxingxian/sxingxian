import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import MediaPicker from '../components/MediaPicker';
import { relTime, useToast } from '../components/ui';
import type { MediaItem } from '../../lib/shared/types';

export default function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();

  const load = () => api.get<{ media: MediaItem[] }>('/api/admin/media').then((r) => setItems(r.media)).catch((e) => setErr(errorText(e)));
  useEffect(() => { void load(); }, []);

  const remove = async (m: MediaItem) => {
    if (!window.confirm('Delete this file? Pages that use it will show a broken image.')) return;
    try {
      await api.del(`/api/admin/media/${m.id}`);
      setItems((xs) => xs?.filter((x) => x.id !== m.id) ?? null);
      toast('Deleted');
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumbs"><b>Media</b></div>
        <div className="actions"><button type="button" className="btn primary" onClick={() => setOpen(true)}>Upload</button></div>
      </div>
      <div className="page">
        <h1>Media</h1>
        <p className="sub">Everything is served from /media/… whichever host it lives on, so files can move hosts later without breaking links.</p>
        {err && <p className="err-text">{err}</p>}
        <div className="lib" style={{ marginTop: 18 }}>
          {items === null && <div className="empty">Loading…</div>}
          {items?.length === 0 && <div className="empty">No media yet.</div>}
          {items?.map((m) => (
            <div key={m.id} className="tile">
              {m.mime.startsWith('image/') ? <img src={`/media/${m.id}`} alt={m.alt} loading="lazy" /> : <div className="drop" style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>{m.provider === 'youtube' || m.provider === 'vimeo' ? `${m.provider} · ${m.embed_id}` : m.mime}</div>}
              <div className="cap"><span>{m.provider.toUpperCase()} · {relTime(m.created_at)}</span><button type="button" className="btn small danger" onClick={() => remove(m)} aria-label={`Delete ${m.filename}`}>✕</button></div>
            </div>
          ))}
        </div>
      </div>
      {open && <MediaPicker imagesOnly={false} onClose={() => setOpen(false)} onPick={() => { setOpen(false); toast('Uploaded'); void load(); }} />}
    </>
  );
}
