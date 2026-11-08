// In-app replacements for window.confirm / alert / prompt.
//   const dialog = useDialog();
//   if (await dialog.confirm({ title: 'Delete post?', danger: true, confirmLabel: 'Delete' })) …
//   await dialog.alert({ title: 'Saved' });
//   const name = await dialog.prompt({ title: 'Rename', defaultValue: 'x' });   // string | null
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Base { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
interface PromptOpts extends Base { defaultValue?: string; placeholder?: string; label?: string; inputMode?: 'url' | 'text'; validate?: (v: string) => string | null }
type Req =
  | ({ kind: 'confirm' } & Base & { resolve: (v: boolean) => void })
  | ({ kind: 'alert' } & Base & { resolve: (v: undefined) => void })
  | ({ kind: 'prompt' } & PromptOpts & { resolve: (v: string | null) => void });

interface DialogApi {
  confirm: (o: Base) => Promise<boolean>;
  alert: (o: Base) => Promise<void>;
  prompt: (o: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDialog needs <DialogProvider>');
  return api;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Req[]>([]);
  const push = useCallback((r: Req) => setQueue((q) => [...q, r]), []);
  const api: DialogApi = {
    confirm: (o) => new Promise((resolve) => push({ kind: 'confirm', ...o, resolve })),
    alert: (o) => new Promise((resolve) => push({ kind: 'alert', ...o, resolve: () => resolve() })),
    prompt: (o) => new Promise((resolve) => push({ kind: 'prompt', ...o, resolve })),
  };
  const current = queue[0];
  const close = (value: unknown) => {
    if (!current) return;
    (current.resolve as (v: unknown) => void)(value);
    setQueue((q) => q.slice(1));
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      {current && <DialogView key={queue.length} req={current} onClose={close} />}
    </Ctx.Provider>
  );
}

function DialogView({ req, onClose }: { req: Req; onClose: (v: unknown) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(req.kind === 'prompt' ? (req.defaultValue ?? '') : '');
  const [closing, setClosing] = useState(false);
  const [invalid, setInvalid] = useState('');

  const cancelValue = req.kind === 'confirm' ? false : req.kind === 'prompt' ? null : undefined;
  const finish = useCallback((v: unknown) => {
    setClosing(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => onClose(v), reduce ? 0 : 120);
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (req.kind === 'prompt' ? input.current : primary.current)?.focus();
    if (req.kind === 'prompt') input.current?.select();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [req.kind]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); finish(cancelValue); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    // keep focus inside the dialog
    const items = panel.current.querySelectorAll<HTMLElement>('button, input');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const confirmLabel = req.confirmLabel ?? (req.kind === 'alert' ? 'OK' : req.kind === 'prompt' ? 'Save' : 'Confirm');
  return (
    <div className={`dlg-back${closing ? ' closing' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget && req.kind !== 'alert') finish(cancelValue); }} onKeyDown={onKey}>
      <div ref={panel} className="dlg" role={req.kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={titleId} aria-describedby={req.body ? bodyId : undefined}>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (req.kind === 'prompt' && req.validate) {
            const problem = req.validate(value);
            if (problem) { setInvalid(problem); input.current?.focus(); return; }
          }
          finish(req.kind === 'confirm' ? true : req.kind === 'prompt' ? value : undefined);
        }}>
          <h2 id={titleId}>{req.title}</h2>
          {req.body && <div id={bodyId} className="dlg-body">{req.body}</div>}
          {req.kind === 'prompt' && (
            <>
              <input ref={input} className={`input${invalid ? ' bad' : ''}`} value={value} onChange={(e) => { setValue(e.target.value); setInvalid(''); }}
                placeholder={req.placeholder} aria-label={req.label ?? req.title} aria-invalid={!!invalid} inputMode={req.inputMode} type={req.inputMode === 'url' ? 'url' : 'text'}
                autoCapitalize="off" spellCheck={false} />
              {invalid && <div className="err-text" role="alert" style={{ marginTop: 6 }}>{invalid}</div>}
            </>
          )}
          <div className="dlg-actions">
            {req.kind !== 'alert' && <button type="button" className="btn" onClick={() => finish(cancelValue)}>{req.cancelLabel ?? 'Cancel'}</button>}
            <button ref={primary} type="submit" className={`btn ${req.danger ? 'danger-solid' : 'primary'}`}>{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
