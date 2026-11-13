import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import MediaPicker, { DocTile } from '../components/MediaPicker';
import { formatBytes, isDocMime } from '../../lib/shared/files';
import { relTime, useToast } from '../components/ui';
import { useDialog } from '../components/dialog';
import Lightbox from '../components/Lightbox';
import { Page, Panel, Segmented, Empty } from '../components/kit';
import type { MediaItem } from '../../lib/shared/types';
import SafeImg from '../components/SafeImg';
import { Pager, setUrlParams, usePaging } from '../components/Pager';
import { pageCount } from '../../lib/shared/paging';

type Kind = 'all' | 'image' | 'video' | 'file';
const KINDS = new Set<Kind>(['all', 'image', 'video', 'file']);
interface MediaPage { media: MediaItem[]; total: number; counts: Record<Kind, number> }

export default function MediaLibrary() {
  const [data, setData] = useState<MediaPage | null>(null);
  const [loading, setLoading] = useState(false);
  const paging = usePaging('media');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const dialog = useDialog();
  const [view, setView] = useState<number | null>(null);
  const [filter, setFilterState] = useState<Kind>(() => {
    const k = new URL(window.location.href).searchParams.get('show') as Kind;
    return KINDS.has(k) ? k : 'all';
  });
  const setFilter = (k: Kind) => { setFilterState(k); setUrlParams({ show: k === 'all' ? null : k }); paging.reset(); };

  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    setLoading(true);
    api.get<MediaPage>(`/api/admin/media?page=${paging.page}&size=${paging.size}&kind=${filter}`).then((r) => {
      if (mine !== seq.current) return;
      if (r.media.length === 0 && r.total > 0 && paging.page > 1) { paging.setPage(pageCount(r.total, paging.size)); return; }
      setData(r); setErr(''); setLoading(false);
    }).catch((e) => { if (mine === seq.current) { setErr(errorText(e)); setLoading(false); } });
  }, [paging, filter]);
  useEffect(load, [load]);

  const remove = async (m: MediaItem) => {
    const ok = await dialog.confirm({ title: 'Delete this file?', body: 'Anywhere it’s used will show a broken image.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/admin/media/${m.id}`);
      toast('Deleted');
      load(); // the next file moves up onto this page
    } catch (e) {
      toast(errorText(e));
    }
  };

  const shown = data?.media ?? [];
  const photos = shown.filter((m) => m.mime.startsWith('image/')); // the lightbox steps through this page's photos
  const c = data?.counts;

  return (
    <Page title="Media" section="media" width="wide" sub={c ? `${c.all} items · ${c.image} photos · ${c.file} files` : undefined}
      actions={<button type="button" className="btn primary" onClick={() => setOpen(true)}>Upload</button>}>
      {err && <div className="alert err" role="alert">{err}</div>}
      <Panel title="Library" desc="Click a photo to view it, or a file to download it."
        actions={<Segmented label="Filter" value={filter} onChange={setFilter} options={[['all', 'All'], ['image', 'Photos'], ['video', 'Video'], ['file', 'Files']] as const} />}>
        {data === null ? <Empty>{err ? '' : 'Loading…'}</Empty> : shown.length === 0 ? <Empty>{data.counts.all === 0 ? 'No media yet. Upload your first file.' : 'Nothing in this filter.'}</Empty> : (
          <div className={`lib${loading ? ' is-loading' : ''}`} aria-busy={loading}>
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
        {data && <div className="lib-pager"><Pager paging={paging} total={data.total} label="Media pages" /></div>}
      </Panel>
      {view !== null && view >= 0 && photos.length > 0 && (
        <Lightbox items={photos.map((m) => ({ src: `/media/${m.id}`, alt: m.alt, caption: m.alt || m.filename }))} start={view} onClose={() => setView(null)} />
      )}
      {open && <MediaPicker accept="all" onClose={() => setOpen(false)} onPick={() => { setOpen(false); toast('Uploaded'); if (paging.page === 1) load(); else paging.setPage(1); }} />}
    </Page>
  );
}
