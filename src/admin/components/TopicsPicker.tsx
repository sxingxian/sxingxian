// Pick an entry's topics (up to MAX_ENTRY_TOPICS) from its section's list in Settings → Topics.
// Selected topics show as chips in the order picked; × removes one. A topic that is no longer in
// the list (renamed elsewhere, or typed before lists existed) shows dashed until it is removed.
import { useEffect, useId, useRef, useState } from 'react';
import { MAX_ENTRY_TOPICS } from '../../lib/shared/types';

interface Props {
  value: string[];
  options: string[] | null; // null = still loading
  onChange: (topics: string[]) => void;
  /** Called with the Settings → Topics path when the owner wants to edit the list. */
  onManage: () => void;
  listName: string; // "Story", "Work", …
}

export default function TopicsPicker({ value, options, onChange, onManage, listName }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const full = value.length >= MAX_ENTRY_TOPICS;
  const inList = (t: string) => !options || options.includes(t);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); addBtn.current?.focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    // Move focus into the list so keyboard users land on the first option.
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLInputElement>('.tp-pop input:not(:disabled)')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = (t: string) => {
    if (value.includes(t)) onChange(value.filter((x) => x !== t));
    else if (!full) onChange([...value, t]);
  };

  return (
    <div className="tp" ref={wrap}>
      <ul className="tp-chips" aria-label={`${listName} topics`}>
        {value.map((t) => (
          <li key={t} className={`tp-chip${inList(t) ? '' : ' stale'}`} title={inList(t) ? undefined : `Not in the ${listName} list any more`}>
            <span>{t}</span>
            <button type="button" className="tp-x" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" /></svg>
            </button>
          </li>
        ))}
        <li>
          <button type="button" ref={addBtn} className="tp-add" aria-expanded={open} aria-controls={popId} aria-haspopup="true"
            onClick={() => setOpen((o) => !o)}>
            <span aria-hidden="true">+</span> {value.length ? 'Add' : 'Add topic'}
          </button>
        </li>
      </ul>
      {open && (
        <div className="tp-pop" id={popId} role="group" aria-label={`${listName} topics, up to ${MAX_ENTRY_TOPICS}`}>
          <div className="tp-head">{listName} topics · {value.length} of {MAX_ENTRY_TOPICS}</div>
          {options === null ? (
            <p className="tp-empty">Loading…</p>
          ) : options.length === 0 ? (
            <p className="tp-empty">No {listName.toLowerCase()} topics yet.</p>
          ) : (
            <div className="tp-list">
              {options.map((t) => {
                const on = value.includes(t);
                return (
                  <label key={t} className={`tp-opt${on ? ' on' : ''}${!on && full ? ' off' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(t)} />
                    <span>{t}</span>
                  </label>
                );
              })}
            </div>
          )}
          {full && options && options.length > 0 && <p className="tp-note">Up to {MAX_ENTRY_TOPICS}. Remove one to pick another.</p>}
          <div className="tp-foot">
            <button type="button" className="linkbtn" onClick={() => { setOpen(false); onManage(); }}>Edit the list in Settings → Topics</button>
          </div>
        </div>
      )}
    </div>
  );
}
