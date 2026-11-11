// The Save button every editor shows. Its label is the save state, so it reads the same on a phone (where the
// small "Saved" text is hidden): Save (unsaved changes) · Saving… · ✓ Saved · Retry (saving failed).
// Changes still save by themselves; tapping Save just does it now.
interface Autosave {
  state: 'saved' | 'pending' | 'saving' | 'error';
  dirty: boolean;
  saveNow: () => void;
}

export default function SaveButton({ auto }: { auto: Autosave }) {
  const s = auto.state === 'error' ? 'error' : auto.state === 'saving' ? 'saving' : auto.dirty ? 'dirty' : 'saved';
  const label = { error: 'Retry', saving: 'Saving…', dirty: 'Save', saved: 'Saved' }[s];
  return (
    <button type="button" className={`btn save-btn is-${s}`} onClick={auto.saveNow} disabled={s === 'saving' || s === 'saved'}
      title="Changes also save by themselves · Ctrl/⌘ S saves now">
      {s === 'saved' && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>}
      {label}
      <span className="sr-only" role="status" aria-live="polite">{s === 'saved' ? 'All changes saved' : s === 'error' ? 'Not saved. Tap to try again' : ''}</span>
    </button>
  );
}
