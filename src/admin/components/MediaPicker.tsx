// Upload dialog + library picker. You choose the storage host per upload.
// Image metadata (GPS, camera serial) is stripped in the browser before upload
// by re-encoding through a canvas; the original never leaves your device.
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import { watermarkAfterUpload } from '../watermark';
import { Field, Segmented, ToggleRow } from './kit';
import type { MediaItem, MediaProvider } from '../../lib/shared/types';
import SafeImg from './SafeImg';
import SelectGrid from './SelectGrid';
import { DOC_ACCEPT, DOC_LIST, docTypeFor, formatBytes, isDocMime } from '../../lib/shared/files';

type Host = 'r2' | 'nas' | 'b2' | 'youtube';
const HOSTS: { id: Host; name: string; desc: string }[] = [
  { id: 'r2', name: 'Cloudflare R2', desc: 'Default · images, clips & files' },
  { id: 'nas', name: 'Home NAS', desc: 'Images & files' },
  { id: 'b2', name: 'Backblaze B2', desc: 'Images & files · archive' },
  { id: 'youtube', name: 'YouTube / Vimeo', desc: 'Long videos' },
];

/** What this picker is for: photos (default), a PDF, any document, or anything (the Media page). */
export type PickerAccept = 'images' | 'pdf' | 'files' | 'all';

interface Props {
  onPick: (m: MediaItem) => void;
  onClose: () => void;
  accept?: PickerAccept;
  /** Pick several photos (up to this many), in order. Uses onPickMany. */
  multiple?: number;
  onPickMany?: (items: MediaItem[]) => void;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
const ACCEPT_ATTR: Record<PickerAccept, string> = {
  images: IMAGE_ACCEPT,
  pdf: '.pdf,application/pdf',
  files: DOC_ACCEPT,
  all: `${IMAGE_ACCEPT},video/mp4,video/webm,${DOC_ACCEPT}`,
};
const TITLES: Record<PickerAccept, string> = { images: 'Add media', pdf: 'Add a PDF', files: 'Add a file', all: 'Add media' };
const HINTS: Record<PickerAccept, string> = {
  images: 'JPG · PNG · WebP · GIF · AVIF',
  pdf: 'PDF · up to 25 MB',
  files: `${DOC_LIST} · up to 25 MB`,
  all: 'Photos · MP4 · WebM · PDF and documents',
};
const fits = (accept: PickerAccept, mime: string) =>
  accept === 'all' ? true : accept === 'images' ? mime.startsWith('image/') : accept === 'pdf' ? mime === 'application/pdf' : isDocMime(mime);

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

export default function MediaPicker({ onPick, onClose, accept = 'images', multiple, onPickMany }: Props) {
  const imagesOnly = accept !== 'all';
  const many = !!multiple && !!onPickMany;
  const [tab, setTab] = useState<'upload' | 'library'>(many ? 'library' : 'upload');
  const [sel, setSel] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState('');
  const [limitHit, setLimitHit] = useState(false);
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
  const isImage = !!file && file.type.startsWith('image/');
  const showImageFields = accept === 'images' || isImage || (accept === 'all' && !file);
  const hostOk = (h: Host) => (h === 'youtube' ? !imagesOnly : !!providers[h]);
  const note =
    isVideo && host !== 'r2' ? 'Videos go to R2 only.' :
    '';

  /** Upload one file (metadata stripped first when asked), then make its watermarked copy if needed. */
  const uploadFile = async (f: File, altText: string): Promise<MediaItem> => {
    const form = new FormData();
    let local: Blob = f;
    if (!f.type.startsWith('video/') && strip && /^image\/(jpeg|png|webp)$/.test(f.type)) {
      const out = await stripMetadata(f);
      local = out.blob;
      form.append('file', new File([out.blob], f.name, { type: out.blob.type }));
      form.append('width', String(out.width));
      form.append('height', String(out.height));
    } else {
      form.append('file', f);
    }
    form.append('provider', host);
    form.append('alt', altText);
    const media = (await api.post<{ media: MediaItem }>('/api/admin/media', form)).media;
    // Watermark on? Make the public copy now, from the local file.
    try {
      await watermarkAfterUpload(media.id, local, media.mime);
    } catch (e) {
      setErr(`Uploaded, but the watermark failed: ${errorText(e)}. Use Settings → Photos → Apply.`);
    }
    return media;
  };

  /** Several photos: upload one after another, then show them selected in the library. */
  const uploadMany = async () => {
    setErr('');
    setBusy(true);
    const added: MediaItem[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        added.push(await uploadFile(files[i], ''));
      }
    } catch (e) {
      setErr(`${errorText(e)}${added.length ? ` (${added.length} uploaded before this)` : ''}`);
    } finally {
      setProgress('');
      setBusy(false);
      if (added.length) {
        setLibrary((lib) => [...added, ...lib.filter((m) => !added.some((a) => a.id === m.id))]);
        setSel((s) => {
          const out = [...s];
          for (const m of added) if (!out.includes(m.id) && out.length < (multiple ?? 0)) out.push(m.id);
          return out;
        });
        setFiles([]);
        setTab('library');
      }
    }
  };

  const upload = async () => {
    if (many) return uploadMany();
    setErr('');
    setBusy(true);
    try {
      let media: MediaItem;
      if (host === 'youtube') {
        media = (await api.post<{ media: MediaItem }>('/api/admin/media', { url, alt })).media;
      } else {
        if (!file) throw new Error('Choose a file first');
        media = await uploadFile(file, alt);
      }
      onPick(media);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const libItems = library.filter((m) => fits(accept, m.mime));
  const addPicked = () => {
    const byId = new Map(library.map((m) => [m.id, m]));
    onPickMany?.(sel.map((id) => byId.get(id)).filter((m): m is MediaItem => !!m));
  };
  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    setFiles(picked.slice(0, multiple ?? 1));
  };

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mp-title">
        <header>
          <h2 id="mp-title">{many ? 'Add photos to gallery' : TITLES[accept]}</h2>
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
                  onDrop={(e) => { e.preventDefault(); setOver(false); if (many) { pickFiles(e.dataTransfer.files); return; } const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
                  {many
                    ? files.length ? <span><b>{files.length} photo{files.length === 1 ? '' : 's'}</b> · {(files.reduce((n, f) => n + f.size, 0) / 1024 / 1024).toFixed(1)} MB</span> : <span>Drop photos here, or</span>
                    : file ? <span><b>{file.name}</b> · {(file.size / 1024 / 1024).toFixed(1)} MB</span> : <span>Drop a file here, or</span>}{' '}
                  <button type="button" className="btn small" onClick={() => inputRef.current?.click()}>{many ? 'Choose photos' : 'Choose file'}</button>
                  <input ref={inputRef} type="file" hidden multiple={many} accept={ACCEPT_ATTR[accept]} onChange={(e) => (many ? pickFiles(e.target.files) : setFile(e.target.files?.[0] ?? null))} />
                </div>
              )}
              {note && <div className="field-hint">{note}</div>}
              {showImageFields && !many && <Field label="Alt text" hint="Describes the image for screen readers." htmlFor="mp-alt"><input id="mp-alt" className="input" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} /></Field>}
              {host !== 'youtube' && showImageFields && (
                <div className="side-toggles">
                  <ToggleRow label="Remove location and camera details" hint="Recommended" checked={strip} onChange={setStrip} />
                </div>
              )}
            </>
          ) : many ? (
            libItems.length === 0 ? <div className="empty">No photos yet. Upload some first.</div> : (
              <>
                <p className="sel-help">Click photos, or drag across them to select several. <span className="sel-help-touch">Press and hold, then slide to select a run.</span></p>
                <SelectGrid items={libItems} selected={sel} onChange={(ids) => { setSel(ids); if (ids.length < (multiple ?? 0)) setLimitHit(false); }} max={multiple ?? 30}
                  onLimit={() => setLimitHit(true)}
                  label={(m) => m.alt || m.filename}
                  render={(m) => <SafeImg src={`/media/${m.id}`} alt="" loading="lazy" draggable={false} />} />
              </>
            )
          ) : (
            <div className="lib">
              {libItems.length === 0 && <div className="empty">No media yet.</div>}
              {libItems.map((m) => (
                <button key={m.id} type="button" onClick={() => onPick(m)} aria-label={`Use ${m.alt || m.filename}`}>
                  {m.mime.startsWith('image/') ? <SafeImg src={`/media/${m.id}`} alt="" loading="lazy" /> : isDocMime(m.mime) ? <DocTile mime={m.mime} name={m.filename} /> : <div className="drop" style={{ aspectRatio: '4/3' }}>{m.provider}</div>}
                  <span className="cap"><span>{isDocMime(m.mime) ? formatBytes(m.bytes) : (m.provider as MediaProvider).toUpperCase()}</span><span>{m.filename.slice(0, 22)}</span></span>
                </button>
              ))}
            </div>
          )}
          {err && <div className="err-text" role="alert">{err}</div>}
        </div>
        {many && tab === 'library' && (
          <footer>
            <span className="sel-count">
              <b>{sel.length} selected</b>
              {limitHit && <span className="hint"> · up to {multiple} in one gallery</span>}
              {sel.length > 0 && <button type="button" className="btn small ghost" onClick={() => { setSel([]); setLimitHit(false); }}>Clear</button>}
            </span>
            <span className="actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={sel.length === 0} onClick={addPicked}>
                {sel.length ? `Add ${sel.length} photo${sel.length === 1 ? '' : 's'}` : 'Add photos'}
              </button>
            </span>
          </footer>
        )}
        {tab === 'upload' && (
          <footer>
            <span className="hint">{HINTS[accept]}</span>
            <span className="actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={busy || (many ? files.length === 0 : host === 'youtube' ? !url : !file) || (isVideo && host !== 'r2')} onClick={upload}>
                {busy ? progress || 'Uploading…' : many ? `Upload ${files.length || ''} photo${files.length === 1 ? '' : 's'}`.replace('  ', ' ') : host === 'youtube' ? 'Add video' : 'Upload'}
              </button>
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}

export function DocTile({ mime, name }: { mime: string; name: string }) {
  const t = docTypeFor(mime, name);
  return <div className="doc-tile"><span className="file-badge" style={{ background: t.color }} aria-hidden="true">{t.badge}</span></div>;
}
