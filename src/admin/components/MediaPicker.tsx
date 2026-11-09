// Upload dialog + library picker. You choose the storage host per upload.
// Image metadata (GPS, camera serial) is stripped in the browser before upload
// by re-encoding through a canvas; the original never leaves your device.
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { watermarkAfterUpload } from '../watermark';
import { Field, Segmented, ToggleRow } from './kit';
import type { MediaItem, MediaProvider } from '../../lib/shared/types';
import SafeImg from './SafeImg';

type Host = 'r2' | 'nas' | 'b2' | 'youtube';
const HOSTS: { id: Host; name: string; desc: string }[] = [
  { id: 'r2', name: 'Cloudflare R2', desc: 'Default · images & clips' },
  { id: 'nas', name: 'Home NAS', desc: 'Images' },
  { id: 'b2', name: 'Backblaze B2', desc: 'Images · archive' },
  { id: 'youtube', name: 'YouTube / Vimeo', desc: 'Long videos' },
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
    isVideo && host !== 'r2' ? 'Videos go to R2 only.' :
    '';

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
        let local: Blob = file;
        if (!isVideo && strip && /^image\/(jpeg|png|webp)$/.test(file.type)) {
          const out = await stripMetadata(file);
          local = out.blob;
          form.append('file', new File([out.blob], file.name, { type: out.blob.type }));
          form.append('width', String(out.width));
          form.append('height', String(out.height));
        } else {
          form.append('file', file);
        }
        form.append('provider', host);
        form.append('alt', alt);
        media = (await api.post<{ media: MediaItem }>('/api/admin/media', form)).media;
        // Watermark on? Make the public copy now, from the local file.
        try {
          await watermarkAfterUpload(media.id, local, media.mime);
        } catch (e) {
          setErr(`Uploaded, but the watermark failed: ${errorText(e)}. Use Settings → Photos → Apply.`);
        }
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
          <Segmented label="Add from" value={tab} onChange={setTab} options={[['upload', 'Upload'], ['library', `Library (${libItems.length})`]] as const} />

          {tab === 'upload' ? (
            <>
              <Field label="Upload to">
              <div className="hosts" role="radiogroup" aria-label="Storage host">
                {HOSTS.filter((h) => !(imagesOnly && h.id === 'youtube')).map((h) => (
                  <button key={h.id} type="button" role="radio" aria-checked={host === h.id} className="host" disabled={!hostOk(h.id)} onClick={() => setHost(h.id)}>
                    <b>{h.name}</b>
                    <span>{hostOk(h.id) ? h.desc : 'Not set up'}</span>
                  </button>
                ))}
              </div>
              </Field>

              {host === 'youtube' ? (
                <Field label="Video link" htmlFor="mp-url"><input id="mp-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></Field>
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
              {note && <div className="field-hint">{note}</div>}
              <Field label="Alt text" hint="Describes the image for screen readers." htmlFor="mp-alt"><input id="mp-alt" className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} /></Field>
              {host !== 'youtube' && (
                <div className="side-toggles">
                  <ToggleRow label="Remove location and camera details" hint="Recommended" checked={strip} onChange={setStrip} />
                </div>
              )}
            </>
          ) : (
            <div className="lib">
              {libItems.length === 0 && <div className="empty">No media yet.</div>}
              {libItems.map((m) => (
                <button key={m.id} type="button" onClick={() => onPick(m)} aria-label={`Use ${m.alt || m.filename}`}>
                  {m.mime.startsWith('image/') ? <SafeImg src={`/media/${m.id}`} alt="" loading="lazy" /> : <div className="drop" style={{ aspectRatio: '4/3' }}>{m.provider}</div>}
                  <span className="cap"><span>{(m.provider as MediaProvider).toUpperCase()}</span><span>{m.filename.slice(0, 18)}</span></span>
                </button>
              ))}
            </div>
          )}
          {err && <div className="err-text" role="alert">{err}</div>}
        </div>
        {tab === 'upload' && (
          <footer>
            <span className="hint">JPG · PNG · WebP · GIF · AVIF · MP4 · WebM</span>
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
