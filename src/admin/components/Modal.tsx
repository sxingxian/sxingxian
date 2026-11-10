// A pop-up for short forms (add/edit). Same look as the media picker (.modal): centred on desktop,
// a bottom sheet on phones. Traps focus, closes on Escape / ✕ / backdrop, gives focus back afterwards,
// and asks before throwing away unsaved changes.
import { useCallback, useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { useDialog } from './dialog';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, footer, onSubmit, dirty = false, busy = false, size = 'sm' }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** When given, the body and footer are a form: Enter submits. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Unsaved changes: closing asks first. */
  dirty?: boolean;
  /** Saving: closing is ignored. */
  busy?: boolean;
  size?: 'sm' | 'lg';
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useDialog();
  const state = useRef({ dirty, busy, onClose });
  state.current = { dirty, busy, onClose };

  const requestClose = useCallback(async () => {
    const s = state.current;
    if (s.busy) return;
    if (s.dirty && !(await dialog.confirm({ title: 'Discard changes?', body: 'What you typed here hasn’t been saved.', confirmLabel: 'Discard', danger: true }))) return;
    s.onClose();
  }, [dialog]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector('.body')?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Let the confirm dialog (rendered on top) handle its own Escape.
      if ((e.target as HTMLElement).closest('.dlg')) return;
      e.stopPropagation();
      void requestClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const inner = (
    <>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </>
  );
  return (
    <div className="modal-back modal-anim" role="presentation" onKeyDown={onKey}
      onMouseDown={(e) => { if (e.target === e.currentTarget) void requestClose(); }}>
      <div ref={panel} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn" onClick={() => void requestClose()} aria-label="Close" disabled={busy}>✕</button>
        </header>
        {onSubmit ? <form onSubmit={onSubmit}>{inner}</form> : inner}
      </div>
    </div>
  );
}
