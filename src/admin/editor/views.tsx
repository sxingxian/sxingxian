// React node views: figure (image), video embed, map, and resizable columns.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { embedSrc, isTikTokShortLink, osmEmbedSrc, parseMapInput, parseVideoUrl, validMapPoint, type VideoProvider } from '../../lib/shared/safe';
import { api, errorText } from '../api';
import SafeImg from '../components/SafeImg';
import { docTypeFor, formatBytes } from '../../lib/shared/files';

type PickMedia = () => Promise<{ id: string; alt: string } | null>;
function picker(editor: NodeViewProps['editor']): PickMedia | null {
  return ((editor.storage as unknown as { sx?: { pickMedia: PickMedia | null } }).sx?.pickMedia) ?? null;
}

// ---------------- figure ----------------

export function FigureView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const { mediaId, alt, caption, size } = node.attrs as { mediaId: string | null; alt: string; caption: string; size: string };
  const replace = async () => {
    const pick = picker(editor);
    const m = pick ? await pick() : null;
    if (m) updateAttributes({ mediaId: m.id, alt: m.alt || alt });
  };
  return (
    <NodeViewWrapper className={`node-figure${selected ? ' selected' : ''}`} data-drag-handle="">
      {mediaId ? <SafeImg src={`/media/${mediaId}`} alt={alt} draggable={false} /> : <div className="drop">No image selected</div>}
      <input className="cap" placeholder="Add a caption…" value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      {selected && editor.isEditable && (
        <div className="tools" contentEditable={false}>
          <label className="sr-only" htmlFor={`alt-${mediaId}`}>Alt text</label>
          <input id={`alt-${mediaId}`} className="input" style={{ height: 30, flex: 1, minWidth: 160 }} placeholder="Alt text (describe the image)" value={alt} onChange={(e) => updateAttributes({ alt: e.target.value })} />
          {(['normal', 'wide', 'full'] as const).map((s) => (
            <button key={s} type="button" className="btn small" aria-pressed={size === s} onClick={() => updateAttributes({ size: s })}>
              {s === 'normal' ? 'Normal' : s === 'wide' ? 'Wide' : 'Full width'}
            </button>
          ))}
          <button type="button" className="btn small" onClick={replace}>Replace</button>
          <button type="button" className="btn small danger" onClick={deleteNode}>Remove</button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ---------------- files: PDF preview and file card ----------------

type PickFile = (kind: 'pdf' | 'file') => Promise<{ id: string; name: string; mime: string; bytes: number } | null>;
function filePicker(editor: NodeViewProps['editor']): PickFile | null {
  return ((editor.storage as unknown as { sx?: { pickFile: PickFile | null } }).sx?.pickFile) ?? null;
}

function FileBadge({ mime, name }: { mime: string; name: string }) {
  const t = docTypeFor(mime, name);
  return <span className="file-badge" style={{ background: t.color }} aria-hidden="true">{t.badge}</span>;
}

export function PdfView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const { mediaId, name, bytes, download } = node.attrs as { mediaId: string | null; name: string; bytes: number; download: boolean };
  const replace = async () => {
    const pick = filePicker(editor);
    const f = pick ? await pick('pdf') : null;
    if (f) updateAttributes({ mediaId: f.id, name: f.name, bytes: f.bytes });
  };
  return (
    <NodeViewWrapper className={`nv-file${selected ? ' selected' : ''}`} data-drag-handle="">
      <div className="file-row" contentEditable={false}>
        <FileBadge mime="application/pdf" name={name} />
        <span className="file-text"><b>{name || 'PDF'}</b><span>PDF preview{bytes ? ` · ${formatBytes(bytes)}` : ''} · {download ? 'Download allowed' : 'View only'}</span></span>
        <span className="file-actions">
          <label className="check-pill"><input type="checkbox" checked={!!download} onChange={(e) => updateAttributes({ download: e.target.checked })} /> Allow download</label>
          <button type="button" className="btn small" onClick={replace}>Replace</button>
          <button type="button" className="btn small danger" onClick={deleteNode} aria-label="Remove PDF">Remove</button>
        </span>
      </div>
      {!mediaId && <div className="drop">No PDF selected</div>}
    </NodeViewWrapper>
  );
}

export function FileView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const { name, mime, bytes } = node.attrs as { mediaId: string | null; name: string; mime: string; bytes: number };
  const t = docTypeFor(mime, name);
  const replace = async () => {
    const pick = filePicker(editor);
    const f = pick ? await pick('file') : null;
    if (f) updateAttributes({ mediaId: f.id, name: f.name, mime: f.mime, bytes: f.bytes });
  };
  return (
    <NodeViewWrapper className={`nv-file${selected ? ' selected' : ''}`} data-drag-handle="">
      <div className="file-row" contentEditable={false}>
        <FileBadge mime={mime} name={name} />
        <span className="file-text"><b>{name || 'File'}</b><span>File · {t.label}{bytes ? ` · ${formatBytes(bytes)}` : ''}</span></span>
        <span className="file-actions">
          <button type="button" className="btn small" onClick={replace}>Replace</button>
          <button type="button" className="btn small danger" onClick={deleteNode} aria-label="Remove file">Remove</button>
        </span>
      </div>
    </NodeViewWrapper>
  );
}

// ---------------- embed ----------------

export function EmbedView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const { provider, videoId, caption, portrait } = node.attrs as { provider: VideoProvider | null; videoId: string; caption: string; portrait: boolean };
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const src = provider && videoId ? embedSrc(provider, videoId) : null;
  const tall = provider === 'tiktok' || portrait;

  const apply = async () => {
    setErr('');
    let link = url.trim();
    if (isTikTokShortLink(link)) {
      setBusy(true);
      try {
        link = (await api.post<{ url: string }>('/api/admin/resolve-link', { url: link })).url;
      } catch (e) {
        setBusy(false);
        return setErr(errorText(e));
      }
      setBusy(false);
    }
    const v = parseVideoUrl(link);
    if (!v) return setErr('Use a YouTube, Shorts, Vimeo or TikTok link');
    updateAttributes({ provider: v.provider, videoId: v.id, portrait: v.portrait });
  };

  return (
    <NodeViewWrapper className={`node-embed node-figure${tall ? ' portrait' : ''}`} data-drag-handle="">
      {src ? (
        <div className="frame">
          <iframe src={src} title={caption || 'Embedded video'} sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" allow="fullscreen; picture-in-picture" />
        </div>
      ) : (
        <div className="paste" contentEditable={false}>
          <input className="input" style={{ flex: 1 }} aria-label="Video link" value={url} autoFocus={editor.isFocused}
            placeholder={portrait ? 'Paste a Shorts or TikTok link' : 'Paste a YouTube or Vimeo link'}
            onChange={(e) => { setUrl(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }} />
          <button type="button" className="btn" disabled={busy || !url.trim()} onClick={() => void apply()}>{busy ? '…' : 'Embed'}</button>
        </div>
      )}
      {err && <div className="err-text">{err}</div>}
      <input className="cap" placeholder="Caption" value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      {selected && (
        <div className="tools" contentEditable={false}>
          {src && <button type="button" className="btn small" onClick={() => updateAttributes({ provider: null, videoId: '' })}>Change</button>}
          <button type="button" className="btn small danger" onClick={deleteNode}>Remove</button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ---------------- map ----------------

interface Place { label: string; lat: number; lon: number }

export function MapView({ node, updateAttributes, selected, deleteNode, editor }: NodeViewProps) {
  const { lat, lon, zoom, label, caption } = node.attrs as { lat: number | null; lon: number | null; zoom: number; label: string; caption: string };
  const point = validMapPoint(lat, lon, zoom);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const text = q.trim();
    if (!text) return;
    setErr('');
    const direct = parseMapInput(text);
    if (direct) {
      updateAttributes({ lat: direct.lat, lon: direct.lon, zoom: direct.zoom });
      return;
    }
    setBusy(true);
    try {
      const r = await api.get<{ places: Place[] }>(`/api/admin/geocode?q=${encodeURIComponent(text)}`);
      setResults(r.places);
      if (!r.places.length) setErr('No places found');
    } catch (e) {
      setErr(errorText(e));
    }
    setBusy(false);
  };

  const choose = (p: Place) => {
    updateAttributes({ lat: p.lat, lon: p.lon, zoom: 16, label: p.label.split(',').slice(0, 2).join(',').trim() });
    setResults(null);
    setQ('');
  };

  return (
    <NodeViewWrapper className="node-embed node-figure node-map" data-drag-handle="">
      {point ? (
        <div className="frame map">
          <iframe src={osmEmbedSrc(point)} title={label || 'Map'} sandbox="allow-scripts allow-same-origin allow-popups" />
        </div>
      ) : (
        <div contentEditable={false}>
          <div className="paste">
            <input className="input" style={{ flex: 1 }} aria-label="Place" value={q} autoFocus={editor.isFocused}
              placeholder="Search a place, or paste a map link / coordinates"
              onChange={(e) => { setQ(e.target.value); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
            <button type="button" className="btn" disabled={busy || !q.trim()} onClick={() => void search()}>{busy ? '…' : 'Find'}</button>
          </div>
          {results && results.length > 0 && (
            <div className="places" role="listbox" aria-label="Places">
              {results.map((p) => (
                <button key={`${p.lat},${p.lon}`} type="button" role="option" aria-selected={false} onClick={() => choose(p)}>{p.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {err && <div className="err-text">{err}</div>}
      {point && (
        <input className="cap" placeholder="Place name" value={label} onChange={(e) => updateAttributes({ label: e.target.value.slice(0, 120) })} />
      )}
      <input className="cap" placeholder="Caption" value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      {selected && (
        <div className="tools" contentEditable={false}>
          {point && (
            <>
              <button type="button" className="btn small" aria-label="Zoom out" disabled={point.zoom <= 2} onClick={() => updateAttributes({ zoom: point.zoom - 1 })}>−</button>
              <span className="status">Zoom {point.zoom}</span>
              <button type="button" className="btn small" aria-label="Zoom in" disabled={point.zoom >= 19} onClick={() => updateAttributes({ zoom: point.zoom + 1 })}>+</button>
              <button type="button" className="btn small" onClick={() => updateAttributes({ lat: null, lon: null })}>Change place</button>
            </>
          )}
          <button type="button" className="btn small danger" onClick={deleteNode}>Remove</button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ---------------- columns ----------------

const MIN = 15;

function normalise(raw: unknown, count: number): number[] {
  const arr = Array.isArray(raw) ? raw.map(Number) : [];
  if (arr.length === count && arr.every((n) => Number.isFinite(n) && n >= MIN)) return arr;
  return count === 3 ? [33, 34, 33] : [50, 50];
}

function resizePair(widths: number[], i: number, delta: number): number[] {
  const sum = widths[i] + widths[i + 1];
  const a = Math.round(Math.max(MIN, Math.min(sum - MIN, widths[i] + delta)));
  const next = widths.slice();
  next[i] = a;
  next[i + 1] = sum - a;
  return next;
}

const PRESETS: Record<number, [string, number[]][]> = {
  2: [['1:1', [50, 50]], ['1:2', [34, 66]], ['2:1', [66, 34]], ['1:3', [25, 75]]],
  3: [['1:1:1', [33, 34, 33]], ['1:2:1', [25, 50, 25]], ['2:1:1', [50, 25, 25]]],
};

export function ColumnsView({ node, updateAttributes, editor, getPos, selected, deleteNode }: NodeViewProps) {
  const count = node.childCount;
  const stored = normalise(node.attrs.widths, count);
  const [live, setLive] = useState<number[] | null>(null);
  const widths = live ?? stored;
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; x: number; w: number; start: number[] } | null>(null);

  useEffect(() => {
    // keep attrs consistent if the column count changed (e.g. via undo)
    const raw = node.attrs.widths;
    if (!Array.isArray(raw) || raw.length !== count) updateAttributes({ widths: normalise(raw, count) });
  }, [count]); // intentionally only re-run when the column count changes

  const down = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { i, x: e.clientX, w: gridRef.current?.getBoundingClientRect().width ?? 1, start: widths.slice() };
    setLive(widths.slice());
  };
  const move = (i: number) => (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.i !== i) return;
    setLive(resizePair(d.start, i, ((e.clientX - d.x) / d.w) * 100));
  };
  const up = () => {
    if (live) updateAttributes({ widths: live });
    drag.current = null;
    setLive(null);
  };
  const key = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    updateAttributes({ widths: resizePair(stored, i, e.key === 'ArrowLeft' ? -2 : 2) });
  };

  const setCount = (n: 2 | 3) => {
    const pos = getPos();
    if (typeof pos !== 'number' || n === count) return;
    const { state, view } = editor;
    const colType = state.schema.nodes.column;
    const pType = state.schema.nodes.paragraph;
    let tr = state.tr;
    if (n > count) {
      tr = tr.insert(pos + node.nodeSize - 1, colType.create(null, pType.create()));
    } else {
      const last = node.child(count - 1);
      const lastStart = pos + node.nodeSize - 1 - last.nodeSize;
      tr = tr.insert(lastStart - 1, last.content); // move its blocks into the previous column
      const shifted = lastStart + last.content.size;
      tr = tr.delete(shifted, shifted + last.nodeSize);
    }
    tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, widths: n === 3 ? [33, 34, 33] : [50, 50] });
    view.dispatch(tr);
  };

  let acc = 0;
  const handles = widths.slice(0, -1).map((w, i) => {
    acc += w;
    return { i, left: acc };
  });

  return (
    <NodeViewWrapper className={`node-columns${selected ? ' selected' : ''}`}>
      <div className="cols-toolbar" contentEditable={false}>
        <span className="lbl">Columns</span>
        <button type="button" className="btn small" aria-pressed={count === 2} onClick={() => setCount(2)}>2</button>
        <button type="button" className="btn small" aria-pressed={count === 3} onClick={() => setCount(3)}>3</button>
        <span className="lbl" style={{ marginLeft: 8 }}>Widths</span>
        {PRESETS[count]?.map(([label, w]) => (
          <button key={label} type="button" className="btn small" onClick={() => updateAttributes({ widths: w })}>{label}</button>
        ))}
        <span className="status" style={{ marginLeft: 4 }}>{widths.join(' / ')} %</span>
        <span className="lbl" style={{ marginLeft: 8 }}>Gap</span>
        {(['s', 'm', 'l'] as const).map((g) => (
          <button key={g} type="button" className="btn small" aria-pressed={node.attrs.gap === g} onClick={() => updateAttributes({ gap: g })}>{g.toUpperCase()}</button>
        ))}
        <label className="check" style={{ fontSize: 12.5 }}><input type="checkbox" checked={node.attrs.stackOnMobile !== false} onChange={(e) => updateAttributes({ stackOnMobile: e.target.checked })} />Stack on phones</label>
        <label className="check" style={{ fontSize: 12.5 }}><input type="checkbox" checked={node.attrs.dividers === true} onChange={(e) => updateAttributes({ dividers: e.target.checked })} />Dividers</label>
        <button type="button" className="btn small danger" onClick={deleteNode}>Delete</button>
      </div>
      <div className="cols-grid" ref={gridRef} style={{ '--sx-cols': widths.map((w) => `${w}fr`).join(' ') } as CSSProperties}>
        <NodeViewContent />
        {editor.isEditable &&
          handles.map((h) => (
            <div
              key={h.i}
              className={`col-handle${drag.current?.i === h.i ? ' dragging' : ''}`}
              style={{ left: `${h.left}%` }}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize columns"
              aria-valuenow={widths[h.i]}
              aria-valuemin={MIN}
              aria-valuemax={100 - MIN}
              tabIndex={0}
              contentEditable={false}
              onPointerDown={down(h.i)}
              onPointerMove={move(h.i)}
              onPointerUp={up}
              onPointerCancel={up}
              onKeyDown={key(h.i)}
            >
              {(live || selected) && <span className="pct">{widths[h.i]} / {widths[h.i + 1]}</span>}
            </div>
          ))}
      </div>
    </NodeViewWrapper>
  );
}
