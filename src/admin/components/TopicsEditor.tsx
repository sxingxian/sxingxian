// Journal topics as chips: add (Enter or comma; pasting a list works), rename (click), reorder
// (drag, or Alt+←/→), remove (×). Shows how many posts use each topic.
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

export const MAX_TOPICS = 12;
export const MAX_TOPIC_LEN = 30;

export interface TopicChange { from: string; to: string }

interface Props {
  topics: string[];
  counts: Record<string, number>;
  onChange: (topics: string[], change?: TopicChange) => void;
  onRemove: (topic: string) => void;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, MAX_TOPIC_LEN);

export default function TopicsEditor({ topics, counts, onChange, onRemove }: Props) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const exists = (t: string, except = -1) => topics.some((x, i) => i !== except && x.toLowerCase() === t.toLowerCase());

  const add = (raw: string) => {
    const parts = raw.split(',').map(norm).filter(Boolean);
    if (!parts.length) return;
    const next = [...topics];
    const skipped: string[] = [];
    for (const p of parts) {
      if (next.length >= MAX_TOPICS) { skipped.push(p); continue; }
      if (next.some((x) => x.toLowerCase() === p.toLowerCase())) { skipped.push(p); continue; }
      next.push(p);
    }
    if (next.length !== topics.length) onChange(next);
    setDraft('');
    setNote(skipped.length ? (next.length >= MAX_TOPICS ? `Up to ${MAX_TOPICS} topics.` : `Already added: ${skipped.join(', ')}`) : '');
  };

  const onAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
    else if (e.key === 'Backspace' && draft === '' && topics.length) chipRefs.current[topics.length - 1]?.focus();
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= topics.length || from === to) return;
    const next = [...topics];
    const [t] = next.splice(from, 1);
    next.splice(to, 0, t);
    onChange(next);
    requestAnimationFrame(() => chipRefs.current[to]?.focus());
  };

  const startEdit = (i: number) => { setEditing(i); setEditText(topics[i]); setNote(''); };
  const commitEdit = () => {
    if (editing === null) return;
    const i = editing;
    const t = norm(editText);
    setEditing(null);
    if (!t || t === topics[i]) return;
    if (exists(t, i)) { setNote(`“${t}” already exists.`); return; }
    const next = [...topics];
    next[i] = t;
    onChange(next, { from: topics[i], to: t });
    requestAnimationFrame(() => chipRefs.current[i]?.focus());
  };

  const onChipKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); move(i, i - 1); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); move(i, i + 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onRemove(topics[i]); }
  };

  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragFrom !== null) move(dragFrom, i);
    setDragFrom(null);
    setDragOver(null);
  };

  const full = topics.length >= MAX_TOPICS;

  return (
    <div className="topics-ed">
      <ul className="chips" aria-label="Topics">
        {topics.map((t, i) => (
          <li key={t} className={`chip${dragFrom === i ? ' dragging' : ''}${dragOver === i && dragFrom !== i ? ' over' : ''}`}
            draggable={editing !== i}
            onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
            onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
            onDrop={onDrop(i)}
            onDragEnd={() => { setDragFrom(null); setDragOver(null); }}>
            <span className="chip-grip" aria-hidden="true">
              <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor"><circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" /><circle cx="2" cy="6" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="2" cy="10" r="1.2" /><circle cx="6" cy="10" r="1.2" /></svg>
            </span>
            {editing === i ? (
              <input className="chip-edit" value={editText} autoFocus maxLength={MAX_TOPIC_LEN} aria-label={`Rename ${t}`}
                size={Math.max(4, editText.length)}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }} />
            ) : (
              <button type="button" className="chip-label" ref={(el) => { chipRefs.current[i] = el; }}
                onClick={() => startEdit(i)} onKeyDown={onChipKey(i)}
                aria-label={`${t}, ${counts[t] ?? 0} posts. Click to rename, Alt+arrows to move, Delete to remove`}>
                {t}
              </button>
            )}
            <span className="chip-count" aria-hidden="true">{counts[t] ?? 0}</span>
            <button type="button" className="chip-x" aria-label={`Remove ${t}`} onClick={() => onRemove(t)}>
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" /></svg>
            </button>
          </li>
        ))}
        <li className="chip-add">
          <input ref={addRef} value={draft} disabled={full} maxLength={MAX_TOPIC_LEN * 4}
            placeholder={full ? `${MAX_TOPICS} topics max` : topics.length ? 'Add topic' : 'Add your first topic'}
            aria-label="Add topic" aria-describedby="topics-help"
            onChange={(e) => { if (e.target.value.includes(',')) add(e.target.value); else { setDraft(e.target.value); setNote(''); } }}
            onKeyDown={onAddKey}
            onBlur={() => draft.trim() && add(draft)} />
        </li>
      </ul>
      <div className="topics-foot" id="topics-help">
        <span>{note || 'Enter to add · click to rename · drag to reorder'}</span>
        <span className="mono">{topics.length}/{MAX_TOPICS}</span>
      </div>
    </div>
  );
}
