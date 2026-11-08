// Upload dialog + library picker. You choose the storage host per upload.
// Image metadata (GPS, camera serial) is stripped in the browser before upload
// by re-encoding through a canvas; the original never leaves your device.
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import type { MediaItem, MediaProvider } from '../../lib/shared/types';

type Host = 'r2' | 'nas' | 'b2' | 'youtube';
const HOSTS: { id: Host; name: string; desc: string }[] = [
  { id: 'r2', name: 'Cloudflare R2', desc: 'Default. Served through the CDN with no egress fees. Images and short clips.' },
  { id: 'nas', name: 'Home NAS', desc: 'Via Cloudflare Tunnel, no open ports. Images only.' },
  { id: 'b2', name: 'Backblaze B2', desc: 'S3-compatible bucket. Images only — good as an archive.' },
  { id: 'youtube', name: 'YouTube / Vimeo', desc: 'Paste a link. Best for long videos.' },
];

interface Props {
  onPick: (m: MediaItem) => void;
  onClose: () => void;
  imagesOnly?: boolean;
}

async function stripMetadata(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process image'))), type, 0.9));
  return { blob, width: canvas.width, height: canvas.height };
}

export default function MediaPicker({ onPick, onClose, imagesOnly = true }: Props) {
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
  const [host, setHost] = useState<Host>('r2');
  const [providers, setProviders] = useState<Record<string, boolean>>({ r2: true });
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [url, setUrl] = useState('');
  const [strip, setStrip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ media: MediaItem[]; providers: Record<string, boolean> }>('/api/admin/media')
      .then((r) => { setLibrary(r.media); setProviders(r.providers); })
      .catch((e) => setErr(errorText(e)));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const isVideo = !!file && file.type.startsWith('video/');
  const hostOk = (h: Host) => (h === 'youtube' ? !imagesOnly : !!providers[h]);
  const note =
    isVideo && host !== 'r2' ? 'Videos can only be stored on R2. Switch to R2, or use YouTube/Vimeo.' :
    host === 'nas' ? 'Images load from your NAS through the tunnel and are cached at the edge.' : '';

  const upload = async () => {
    setErr('');
    setBusy(true);
    try {
      let media: MediaItem;
      if (host === 'youtube') {
        media = (await api.post<{ media: MediaItem }>('/api/admin/media', { url, alt })).media;
      } else {
        if (!file) throw new Error('Choose a file first');
        const form = new FormData();
        if (!isVideo && strip && /^image\/(jpeg|png|webp)$/.test(file.type)) {
          const out = await stripMetadata(file);
          form.append('file', new File([out.blob], file.name, { type: out.blob.type }));
          form.append('width', String(out.width));
          form.append('height', String(out.height));
        } else {
          form.append('file', file);
        }
        form.append('provider', host);
        form.append('alt', alt);
        media = (await api.post<{ media: MediaItem }>('/api/admin/media', form)).media;
      }
      onPick(media);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const libItems = library.filter((m) => (imagesOnly ? m.mime.startsWith('image/') : true));

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mp-title">
        <header>
          <h2 id="mp-title">Add media</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="body">
          <div className="tabs" role="tablist" style={{ margin: 0 }}>
            <button type="button" role="tab" aria-selected={tab === 'upload'} onClick={() => setTab('upload')}>Upload</button>
            <button type="button" role="tab" aria-selected={tab === 'library'} onClick={() => setTab('library')}>Library ({libItems.length})</button>
          </div>

          {tab === 'upload' ? (
            <>
              <div className="lbl">Upload to</div>
              <div className="hosts" role="radiogroup" aria-label="Storage host">
                {HOSTS.filter((h) => !(imagesOnly && h.id === 'youtube')).map((h) => (
                  <button key={h.id} type="button" role="radio" aria-checked={host === h.id} className="host" disabled={!hostOk(h.id)} onClick={() => setHost(h.id)}>
                    <b>{h.name}</b>
                    <span>{hostOk(h.id) ? h.desc : 'Not configured — add its credentials as Worker secrets.'}</span>
                  </button>
                ))}
              </div>

              {host === 'youtube' ? (
                <label className="field">Video link<input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
              ) : (
                <div className={`drop${over ? ' over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
                  {file ? <span><b>{file.name}</b> · {(file.size / 1024 / 1024).toFixed(1)} MB</span> : <span>Drop a file here, or</span>}{' '}
                  <button type="button" className="btn small" onClick={() => inputRef.current?.click()}>Choose file</button>
                  <input ref={inputRef} type="file" hidden accept={imagesOnly ? 'image/jpeg,image/png,image/webp,image/gif,image/avif' : 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
              )}
              {note && <div className="hint">{note}</div>}
              <label className="field">Alt text (describe the image for screen readers)<input className="input" value={alt} onChange={(e) => setAlt(e.target.value)} /></label>
              {host !== 'youtube' && (
                <label className="check"><input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} />Remove location and camera details (recommended)</label>
              )}
            </>
          ) : (
            <div className="lib">
              {libItems.length === 0 && <div className="empty">No media yet.</div>}
              {libItems.map((m) => (
                <button key={m.id} type="button" onClick={() => onPick(m)} aria-label={`Use ${m.alt || m.filename}`}>
                  {m.mime.startsWith('image/') ? <img src={`/media/${m.id}`} alt="" loading="lazy" /> : <div className="drop" style={{ aspectRatio: '4/3' }}>{m.provider}</div>}
                  <span className="cap"><span>{(m.provider as MediaProvider).toUpperCase()}</span><span>{m.filename.slice(0, 18)}</span></span>
                </button>
              ))}
            </div>
          )}
          {err && <div className="err-text" role="alert">{err}</div>}
        </div>
        {tab === 'upload' && (
          <footer>
            <span className="hint">Files are checked on the server; SVG and HTML are never accepted.</span>
            <span className="actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={busy || (host === 'youtube' ? !url : !file) || (isVideo && host !== 'r2')} onClick={upload}>
                {busy ? 'Uploading…' : host === 'youtube' ? 'Add video' : 'Upload'}
              </button>
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}
