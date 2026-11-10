// A grid of media you can select several of, in order (the order becomes the gallery order).
//   Click / tap / Enter / Space   toggle one
//   Shift-click                   select everything between the last clicked and this one
//   Drag (mouse or pen)           draw a box; everything it touches is selected (⌘/Ctrl: removed)
//   Press and hold, then slide    (touch) select or unselect a run of photos, like the Photos app
//   Arrows / Shift+arrows / ⌘A    move, extend, select all
// The grid scrolls while dragging near its top or bottom edge.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';

interface Props<T extends { id: string }> {
  items: T[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
  render: (item: T) => ReactNode;
  label: (item: T) => string;
  onLimit?: () => void;
}

const DRAG_START = 5; // px before a press becomes a box selection
const HOLD_MS = 380; // touch: hold this long to start sliding selection
const EDGE = 48; // px from the top/bottom edge where dragging scrolls

interface Box { x0: number; y0: number; x1: number; y1: number }

export default function SelectGrid<T extends { id: string }>({ items, selected, onChange, max, render, label, onLimit }: Props<T>) {
  const grid = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [focus, setFocus] = useState(0);
  const anchor = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(selected);
  latest.current = selected;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** Add ids (in the given order) up to the limit, or remove them. */
  const apply = useCallback(
    (base: string[], ids: string[], mode: 'add' | 'remove'): string[] => {
      if (mode === 'remove') {
        const drop = new Set(ids);
        return base.filter((id) => !drop.has(id));
      }
      const out = [...base];
      let hitLimit = false;
      for (const id of ids) {
        if (out.includes(id)) continue;
        if (out.length >= max) { hitLimit = true; break; }
        out.push(id);
      }
      if (hitLimit) onLimit?.();
      return out;
    },
    [max, onLimit],
  );

  const toggle = (i: number, shift: boolean) => {
    const id = items[i]?.id;
    if (!id) return;
    if (shift && anchor.current !== null) {
      const [a, b] = anchor.current < i ? [anchor.current, i] : [i, anchor.current];
      onChange(apply(latest.current, items.slice(a, b + 1).map((it) => it.id), 'add'));
    } else {
      onChange(latest.current.includes(id) ? apply(latest.current, [id], 'remove') : apply(latest.current, [id], 'add'));
      anchor.current = i;
    }
    setFocus(i);
  };

  // ---- Box selection (mouse / pen) -------------------------------------------------------------
  const lastMove = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; base: string[]; mode: 'add' | 'remove'; active: boolean; clientY: number; raf: number; pointerId: number } | null>(null);

  const point = (clientX: number, clientY: number) => {
    const g = grid.current!;
    const r = g.getBoundingClientRect();
    return { x: clientX - r.left + g.scrollLeft, y: clientY - r.top + g.scrollTop };
  };

  const hits = (b: Box): string[] => {
    const g = grid.current;
    if (!g) return [];
    const [l, r, t, btm] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1), Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const out: string[] = [];
    g.querySelectorAll<HTMLElement>('[data-sel-id]').forEach((el) => {
      const x = el.offsetLeft, y = el.offsetTop;
      if (x < r && x + el.offsetWidth > l && y < btm && y + el.offsetHeight > t) out.push(el.dataset.selId as string);
    });
    return out;
  };

  const update = (clientX: number, clientY: number) => {
    const d = drag.current;
    if (!d) return;
    const p = point(clientX, clientY);
    if (!d.active && Math.hypot(p.x - d.x, p.y - d.y) < DRAG_START) return;
    if (!d.active) {
      // Capture only once it's a real drag: capturing on press would send the click to the grid, not the photo.
      try { grid.current?.setPointerCapture(d.pointerId); } catch { /* pointer already gone */ }
    }
    d.active = true;
    d.clientY = clientY;
    const b = { x0: d.x, y0: d.y, x1: p.x, y1: p.y };
    setBox(b);
    onChange(apply(d.base, hits(b), d.mode));
  };

  const autoScroll = () => {
    const d = drag.current, g = grid.current;
    if (!d || !g) return;
    if (d.active) {
      const r = g.getBoundingClientRect();
      const dy = d.clientY < r.top + EDGE ? -Math.ceil((r.top + EDGE - d.clientY) / 4) : d.clientY > r.bottom - EDGE ? Math.ceil((d.clientY - (r.bottom - EDGE)) / 4) : 0;
      if (dy) {
        g.scrollTop += Math.max(-24, Math.min(24, dy));
        lastMove.current && update(lastMove.current.x, lastMove.current.y);
      }
    }
    d.raf = requestAnimationFrame(autoScroll);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    // Let scrollbar drags through.
    const g = grid.current!;
    const r = g.getBoundingClientRect();
    if (e.clientX > r.left + g.clientWidth) return;
    e.preventDefault(); // no text selection or native image drag
    const p = point(e.clientX, e.clientY);
    drag.current = { x: p.x, y: p.y, base: latest.current, mode: e.metaKey || e.ctrlKey ? 'remove' : 'add', active: false, clientY: e.clientY, raf: 0, pointerId: e.pointerId };
    drag.current.raf = requestAnimationFrame(autoScroll);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    lastMove.current = { x: e.clientX, y: e.clientY };
    update(e.clientX, e.clientY);
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    if (d.active) {
      // The click that may follow a box drag isn't a toggle. Browsers don't always send one, so clear
      // the flag right after either way, or the next real click would be swallowed.
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    drag.current = null;
    lastMove.current = null;
    setBox(null);
    try { grid.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  // ---- Press and slide (touch) -----------------------------------------------------------------
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    // Registered once: selecting re-renders the grid, and a re-registration would lose a slide in progress.
    const g = grid.current;
    if (!g) return;
    const apply = (base: string[], ids: string[], mode: 'add' | 'remove') => applyRef.current(base, ids, mode);
    const onChange = (ids: string[]) => onChangeRef.current(ids);
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let paint: { mode: 'add' | 'remove'; base: string[]; seen: string[] } | null = null;
    const idAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-sel-id]')?.dataset.selId;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      const first = idAt(t.clientX, t.clientY);
      if (!first) return;
      timer = window.setTimeout(() => {
        const base = latest.current;
        paint = { mode: base.includes(first) ? 'remove' : 'add', base, seen: [first] };
        onChange(apply(base, [first], paint.mode));
        suppressClick.current = true;
        navigator.vibrate?.(8);
      }, HOLD_MS);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!paint) {
        if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) window.clearTimeout(timer); // it's a scroll
        return;
      }
      e.preventDefault(); // keep the page still while sliding
      const id = idAt(t.clientX, t.clientY);
      if (id && !paint.seen.includes(id)) {
        paint.seen.push(id);
        onChange(apply(paint.base, paint.seen, paint.mode));
      }
    };
    const onEnd = () => {
      window.clearTimeout(timer);
      if (paint) window.setTimeout(() => { suppressClick.current = false; }, 400); // after the tap's delayed click
      paint = null;
      start = null;
    };
    g.addEventListener('touchstart', onStart, { passive: true });
    g.addEventListener('touchmove', onMove, { passive: false });
    g.addEventListener('touchend', onEnd);
    g.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(timer);
      g.removeEventListener('touchstart', onStart);
      g.removeEventListener('touchmove', onMove);
      g.removeEventListener('touchend', onEnd);
      g.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // ---- Keyboard --------------------------------------------------------------------------------
  const columns = () => {
    const els = grid.current?.querySelectorAll<HTMLElement>('[data-sel-id]');
    if (!els || els.length < 2) return 1;
    const top = els[0].offsetTop;
    let n = 0;
    for (const el of Array.from(els)) { if (el.offsetTop !== top) break; n++; }
    return Math.max(1, n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onChange(apply(latest.current, items.map((it) => it.id), 'add'));
      return;
    }
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key as string];
    if (!step) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(items.length - 1, focus + step));
    if (e.shiftKey) {
      const id = items[next]?.id;
      if (id) onChange(apply(latest.current, [items[focus].id, id], 'add'));
    }
    setFocus(next);
    grid.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  };

  return (
    <div ref={grid} className="sel-grid" role="listbox" aria-multiselectable="true" aria-label="Photos"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKeyDown}
      onClickCapture={(e) => {
        // The click that ends a box drag or a press-and-slide isn't a toggle. (After a captured drag the browser
        // aims it at the grid, so it's handled here, before any photo sees it.)
        if (suppressClick.current) { suppressClick.current = false; e.stopPropagation(); e.preventDefault(); }
      }}>
      {items.map((it, i) => {
        const n = selected.indexOf(it.id);
        return (
          <button key={it.id} type="button" role="option" aria-selected={n >= 0} data-sel-id={it.id} data-index={i}
            tabIndex={i === focus ? 0 : -1} className={`sel-tile${n >= 0 ? ' on' : ''}`} aria-label={label(it)}
            onClick={(e) => toggle(i, e.shiftKey)}>
            {render(it)}
            <span className="sel-badge" aria-hidden="true">{n >= 0 ? n + 1 : ''}</span>
          </button>
        );
      })}
      {box && (
        <div className="sel-box" aria-hidden="true" style={{
          left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1),
          width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0),
        }} />
      )}
    </div>
  );
}
