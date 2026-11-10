// Gallery block in the editor: grid or masonry, 2–4 columns, add photos (multi-select picker), drag to reorder,
// remove, per-photo alt text and an optional caption. The site renders it in src/lib/server/render.ts.
//
// Reordering: drag a photo with the mouse; on touch screens drag the ⠿ handle on each photo; from the keyboard,
// focus a photo and press Alt+← / Alt+→. Removing a photo only takes it out of this gallery.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import SafeImg from '../components/SafeImg';
import type { GalleryItem, PickedImage } from './nodes';

export const MAX_GALLERY = 30;

type PickImages = (max: number) => Promise<PickedImage[] | null>;
function imagesPicker(editor: NodeViewProps['editor']): PickImages | null {
  return ((editor.storage as unknown as { sx?: { pickImages: PickImages | null } }).sx?.pickImages) ?? null;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

export function GalleryView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as { items: GalleryItem[]; layout: string; columns: number; caption: string };
  const items = Array.isArray(attrs.items) ? attrs.items : [];
  const layout = attrs.layout === 'masonry' ? 'masonry' : 'grid';
  const columns = [2, 3, 4].includes(Number(attrs.columns)) ? Number(attrs.columns) : 3;
  const editable = editor.isEditable;

  // While dragging, show the new order without writing it to the document until the drop.
  const [preview, setPreview] = useState<GalleryItem[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [altFor, setAltFor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const tiles = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; active: boolean; pointerId: number } | null>(null);
  const shown = preview ?? items;

  const set = (next: GalleryItem[]) => updateAttributes({ items: next });

  const add = async () => {
    const pick = imagesPicker(editor);
    const room = MAX_GALLERY - items.length;
    if (!pick || room < 1) return;
    const list = await pick(room);
    if (!list?.length) return;
    const have = new Set(items.map((i) => i.mediaId));
    set([...items, ...list.filter((m) => !have.has(m.id)).map((m) => ({ mediaId: m.id, alt: m.alt, w: m.w, h: m.h }))].slice(0, MAX_GALLERY));
  };

  const remove = (id: string) => {
    const next = items.filter((i) => i.mediaId !== id);
    if (next.length === 0) deleteNode();
    else set(next);
  };

  // ---- drag to reorder -------------------------------------------------------------------------
  const indexAt = (x: number, y: number): number => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-gi]');
    return el && tiles.current?.contains(el) ? Number(el.dataset.gi) : -1;
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>, id: string, viaHandle: boolean) => {
    if (!editable || e.button !== 0) return;
    if (e.pointerType === 'touch' && !viaHandle) return; // touch: only the handle drags, so the page still scrolls
    if ((e.target as HTMLElement).closest('button:not(.gal-handle), input')) return;
    e.preventDefault();
    drag.current = { id, x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId };
  };
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        d.active = true;
        setDragId(d.id);
      }
      const base = preview ?? items;
      const to = indexAt(e.clientX, e.clientY);
      const from = base.findIndex((i) => i.mediaId === d.id);
      if (to >= 0 && from >= 0 && to !== from) setPreview(move(base, from, to));
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      drag.current = null;
      if (d.active && preview) {
        set(preview);
        const n = preview.findIndex((i) => i.mediaId === d.id) + 1;
        setStatus(`Moved to position ${n} of ${preview.length}`);
      }
      setPreview(null);
      setDragId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  });

  const onTileKey = (e: KeyboardEvent<HTMLElement>, i: number) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const to = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)));
    if (to === i) return;
    set(move(items, i, to));
    setStatus(`Moved to position ${to + 1} of ${items.length}`);
    requestAnimationFrame(() => tiles.current?.querySelector<HTMLElement>(`[data-gi="${to}"]`)?.focus());
  };

  return (
    <NodeViewWrapper className={`nv-gallery${selected ? ' selected' : ''}`}>
      {editable && (
        <div className="gal-tools" contentEditable={false}>
          <span className="seg-mini" role="group" aria-label="Layout">
            {(['grid', 'masonry'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={layout === l} onClick={() => updateAttributes({ layout: l })}>{l === 'grid' ? 'Grid' : 'Masonry'}</button>
            ))}
          </span>
          <span className="seg-mini" role="group" aria-label="Columns">
            {[2, 3, 4].map((c) => (
              <button key={c} type="button" aria-pressed={columns === c} aria-label={`${c} columns`} onClick={() => updateAttributes({ columns: c })}>{c}</button>
            ))}
          </span>
          <span className="gal-tools-end">
            <span className="gal-count">{items.length} / {MAX_GALLERY}</span>
            <button type="button" className="btn small" disabled={items.length >= MAX_GALLERY} onClick={add}>+ Add photos</button>
            {selected && <button type="button" className="btn small danger" onClick={deleteNode}>Remove gallery</button>}
          </span>
        </div>
      )}

      <div ref={tiles} className={`gal-tiles gal-${layout} gal-c${columns}${dragId ? ' is-dragging' : ''}`} contentEditable={false}
        role="list" aria-label={`Gallery, ${items.length} photos`} aria-describedby={editable ? `gal-help-${node.attrs.items?.[0]?.mediaId ?? 'x'}` : undefined}>
        {shown.map((it, i) => (
          <div key={it.mediaId} role="listitem" data-gi={i} tabIndex={editable ? 0 : -1}
            className={`gal-tile${dragId === it.mediaId ? ' lifted' : ''}${it.alt ? '' : ' no-alt'}`}
            aria-label={`Photo ${i + 1}${it.alt ? `: ${it.alt}` : ', no alt text'}`}
            onPointerDown={(e) => onPointerDown(e, it.mediaId, false)} onKeyDown={(e) => onTileKey(e, i)}>
            <SafeImg src={`/media/${it.mediaId}`} alt="" draggable={false} loading="lazy" />
            {editable && (
              <>
                <button type="button" className="gal-handle" aria-hidden="true" tabIndex={-1} onPointerDown={(e) => onPointerDown(e, it.mediaId, true)}>⠿</button>
                <button type="button" className="gal-x" aria-label={`Remove photo ${i + 1} from gallery`} onClick={() => remove(it.mediaId)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" /></svg>
                </button>
                <button type="button" className="gal-altbtn" aria-expanded={altFor === it.mediaId} onClick={() => setAltFor(altFor === it.mediaId ? null : it.mediaId)}>
                  {it.alt ? 'Alt ✓' : '+ Alt text'}
                </button>
              </>
            )}
            {altFor === it.mediaId && editable && (
              <div className="gal-alt" contentEditable={false}>
                <label htmlFor={`gal-alt-${it.mediaId}`}>Alt text for photo {i + 1}</label>
                <input id={`gal-alt-${it.mediaId}`} className="input" autoFocus maxLength={300} placeholder="Describe the photo" value={it.alt}
                  onChange={(e) => set(items.map((x) => (x.mediaId === it.mediaId ? { ...x, alt: e.target.value } : x)))}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setAltFor(null); } }}
                  onBlur={() => setAltFor(null)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <input className="gal-cap cap" placeholder="Add a caption…" value={attrs.caption ?? ''} maxLength={500} readOnly={!editable}
        onChange={(e) => updateAttributes({ caption: e.target.value })} />
      {editable && (
        <p id={`gal-help-${node.attrs.items?.[0]?.mediaId ?? 'x'}`} className="sr-only">
          Drag photos to reorder, or focus a photo and press Alt and an arrow key.
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </NodeViewWrapper>
  );
}
