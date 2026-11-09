// Autosave for the editors.
//
// The editor passes a snapshot (a JSON string of everything it would save) on every render. The first
// snapshot is the baseline, so opening a document never saves it. When the snapshot changes, a save runs
// 1.2 s after the last change, or at the latest 8 s after the first unsaved change while you keep typing.
// Only one save runs at a time; edits made during a save are picked up by the next one. A failed save is
// retried after 10 s (and on the next change). Leaving the tab or the editor saves straight away, and the
// browser warns before closing with unsaved changes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './api';

export type AutosaveState = 'saved' | 'pending' | 'saving' | 'error';

const DELAY = 1200;
const MAX_WAIT = 8000;
const RETRY = 10_000;

/** persist(snapshot) saves it and may return the snapshot as the server normalised it (e.g. a de-duplicated slug). */
export function useAutosave(snapshot: string | null, persist: (snapshot: string) => Promise<string | void>) {
  const saved = useRef<string | null>(null);
  const latest = useRef<string | null>(snapshot);
  const persistRef = useRef(persist);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstChange = useRef<number | null>(null);
  const [state, setState] = useState<AutosaveState>('saved');
  const [error, setError] = useState('');

  latest.current = snapshot;
  persistRef.current = persist;
  if (snapshot === null) saved.current = null; // nothing loaded (yet): the next snapshot becomes the baseline
  else if (saved.current === null) saved.current = snapshot; // baseline: what was loaded

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    const snap = latest.current;
    if (snap === null || snap === saved.current) {
      firstChange.current = null;
      setState((s) => (s === 'error' ? s : 'saved'));
      return;
    }
    if (inflight.current) return; // the running save reschedules when it finishes
    inflight.current = true;
    firstChange.current = null;
    setState('saving');
    try {
      const normalised = await persistRef.current(snap);
      saved.current = typeof normalised === 'string' ? normalised : snap;
      setError('');
    } catch (e) {
      setError(errorText(e));
      setState('error');
      inflight.current = false;
      timer.current = setTimeout(() => void flush(), RETRY);
      return;
    }
    inflight.current = false;
    if (latest.current !== saved.current) {
      setState('pending');
      firstChange.current = Date.now();
      timer.current = setTimeout(() => void flush(), DELAY);
    } else {
      setState('saved');
    }
  }, []);

  // Debounce on every change.
  useEffect(() => {
    if (snapshot === null || snapshot === saved.current || inflight.current) return;
    const now = Date.now();
    if (firstChange.current === null) firstChange.current = now;
    setState((s) => (s === 'error' ? s : 'pending'));
    clearTimeout(timer.current);
    const wait = Math.max(0, Math.min(DELAY, MAX_WAIT - (now - firstChange.current)));
    timer.current = setTimeout(() => void flush(), wait);
  }, [snapshot, flush]);

  // Save when the tab is hidden, warn before closing, and save on leaving the editor.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onUnload = (e: BeforeUnloadEvent) => { if (latest.current !== null && latest.current !== saved.current) e.preventDefault(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
      clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  /** Save now (Ctrl/Cmd+S, the Save button, or a deliberate switch like Draft → Published). */
  const saveNow = useCallback(() => { setTimeout(() => void flush(), 0); }, [flush]);
  /** Forget unsaved changes (e.g. after deleting the document). */
  const discard = useCallback(() => { clearTimeout(timer.current); saved.current = latest.current; firstChange.current = null; setState('saved'); setError(''); }, []);
  const dirty = snapshot !== null && snapshot !== saved.current;
  const label = state === 'error' ? 'Not saved · retrying' : state === 'saving' ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved';
  return { state, error, dirty, label, saveNow, discard };
}
