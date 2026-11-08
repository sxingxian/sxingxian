// Full-screen photo viewer for the admin media library: arrows / swipe / Esc, focus kept inside.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface LightboxItem { src: string; alt: string; caption: string }

export default function Lightbox({ items, start, onClose }: { items: LightboxItem[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const closeRef = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const touchX = useRef(0);
  const go = (step: number) => setI((n) => (n + step + items.length) % items.length);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Tab' && box.current) {
      const f = box.current.querySelectorAll<HTMLElement>('button');
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };

  const item = items[i];
  return (
    <div ref={box} className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onKeyDown={onKey}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}>
      <div className="lb-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <img className="lb-img" src={item.src} alt={item.alt} draggable={false} />
      </div>
      <div className="lb-foot"><span>{item.caption}</span><span className="lb-count">{items.length > 1 ? `${i + 1} / ${items.length}` : ''}</span></div>
      {items.length > 1 && <button type="button" className="lb-nav lb-prev" aria-label="Previous photo" onClick={() => go(-1)}>‹</button>}
      {items.length > 1 && <button type="button" className="lb-nav lb-next" aria-label="Next photo" onClick={() => go(1)}>›</button>}
      <button ref={closeRef} type="button" className="lb-close" aria-label="Close" onClick={onClose}>×</button>
    </div>
  );
}
