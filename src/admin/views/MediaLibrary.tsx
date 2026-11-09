import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import MediaPicker, { DocTile } from '../components/MediaPicker';
import { formatBytes, isDocMime } from '../../lib/shared/files';
import { relTime, useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import Lightbox from '../components/Lightbox';
import { Page, Panel, Segmented, Empty } from '../components/kit';
import type { MediaItem } from '../../lib/shared/types';
import SafeImg from '../components/SafeImg';

export default function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const dialog = useDialog();
  const [view, setView] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'file'>('all');

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
  const kindOf = (m: MediaItem) => (m.mime.startsWith('image/') ? 'image' : isDocMime(m.mime) ? 'file' : 'video');
  const shown = (items ?? []).filter((m) => filter === 'all' || kindOf(m) === filter);

  return (
    <Page title="Media" width="wide" sub={items ? `${items.length} items · ${photos.length} photos · ${items.filter((m) => isDocMime(m.mime)).length} files` : undefined}
      actions={<button type="button" className="btn primary" onClick={() => setOpen(true)}>Upload</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      <Panel title="Library" desc="Click a photo to view it, or a file to download it."
        actions={<Segmented label="Filter" value={filter} onChange={setFilter} options={[['all', 'All'], ['image', 'Photos'], ['video', 'Video'], ['file', 'Files']] as const} />}>
        {items === null ? <Empty>Loading…</Empty> : shown.length === 0 ? <Empty>{items.length === 0 ? 'No media yet. Upload your first file.' : 'Nothing in this filter.'}</Empty> : (
          <div className="lib">
            {shown.map((m) => (
              <div key={m.id} className="tile">
                {m.mime.startsWith('image/') ? (
                  <button type="button" className="lib-open" aria-label={`View ${m.alt || m.filename}`} onClick={() => setView(photos.findIndex((x) => x.id === m.id))}>
                    <SafeImg src={`/media/${m.id}`} alt={m.alt} loading="lazy" />
                  </button>
                ) : isDocMime(m.mime) ? (
                  <a className="lib-open" href={`/media/${m.id}`} download aria-label={`Download ${m.filename}`}><DocTile mime={m.mime} name={m.filename} /></a>
                ) : <div className="drop" style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>{m.provider === 'youtube' || m.provider === 'vimeo' ? `${m.provider} · ${m.embed_id}` : m.mime}</div>}
                <div className="cap"><span title={m.filename}>{isDocMime(m.mime) ? `${m.filename.slice(0, 24)} · ${formatBytes(m.bytes)}` : `${m.provider.toUpperCase()} · ${relTime(m.created_at)}`}</span><button type="button" className="btn small danger" onClick={() => remove(m)} aria-label={`Delete ${m.filename}`}>✕</button></div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {view !== null && view >= 0 && photos.length > 0 && (
        <Lightbox items={photos.map((m) => ({ src: `/media/${m.id}`, alt: m.alt, caption: m.alt || m.filename }))} start={view} onClose={() => setView(null)} />
      )}
      {open && <MediaPicker accept="all" onClose={() => setOpen(false)} onPick={() => { setOpen(false); toast('Uploaded'); void load(); }} />}
    </Page>
  );
}
