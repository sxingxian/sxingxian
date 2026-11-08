// React node views: figure (image), video embed, and resizable columns.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { embedSrc, parseVideoUrl } from '../../lib/shared/safe';

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
      {mediaId ? <img src={`/media/${mediaId}`} alt={alt} draggable={false} /> : <div className="drop">No image selected</div>}
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

// ---------------- embed ----------------

export function EmbedView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const { provider, videoId, caption } = node.attrs as { provider: 'youtube' | 'vimeo' | null; videoId: string; caption: string };
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const src = provider && videoId ? embedSrc(provider, videoId) : null;
  const apply = () => {
    const v = parseVideoUrl(url);
    if (!v) return setErr('Paste a YouTube or Vimeo link');
    updateAttributes({ provider: v.provider, videoId: v.id });
  };
  return (
    <NodeViewWrapper className="node-embed node-figure" data-drag-handle="">
      {src ? (
        <div className="frame">
          <iframe src={src} title={caption || 'Embedded video'} sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen; picture-in-picture" />
        </div>
      ) : (
        <div className="paste" contentEditable={false}>
          <label className="sr-only" htmlFor="embed-url">Video link</label>
          <input id="embed-url" className="input" style={{ flex: 1 }} placeholder="Paste a YouTube or Vimeo link and press Enter" value={url}
            onChange={(e) => { setUrl(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} />
          <button type="button" className="btn" onClick={apply}>Embed</button>
        </div>
      )}
      {err && <div className="err-text">{err}</div>}
      <input className="cap" placeholder="Add a caption…" value={caption} onChange={(e) => updateAttributes({ caption: e.target.value })} />
      {selected && <div className="tools" contentEditable={false}><button type="button" className="btn small danger" onClick={deleteNode}>Remove</button></div>}
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
