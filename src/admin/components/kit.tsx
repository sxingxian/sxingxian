// The admin's building blocks. Every screen is made from these so layout, spacing, labels,
// controls and saving behave the same everywhere:
//   <TopBar> breadcrumb + actions · <Page> topbar + heading · <Panel> titled card · <Row> label/hint + control
//   <ToggleRow> label/hint + switch · <Segmented> one-of choice · <SaveBar> dirty state + save
import type { MouseEvent, ReactNode } from 'react';
import { Switch } from './ui';
import { SECTIONS, useGo, type SectionKey } from '../nav';
import { lastListUrl } from './Pager';

/**
 * The bar at the top of every admin screen: breadcrumb on the left, actions on the right.
 * Trail = Group / Section / here. The section is a link only when there is a "here" below it
 * (an item in the editor, a tab in Settings); onSection replaces the link's default navigation.
 * Phones show a single "‹ Section" back link on deeper screens, or just the section name.
 */
export function TopBar({ section, here, onSection, actions }: {
  section: SectionKey; here?: string; onSection?: () => void; actions?: ReactNode;
}) {
  const go = useGo();
  const s = SECTIONS[section];
  const deep = here !== undefined && here !== '';
  const open = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open a new tab
    e.preventDefault();
    if (onSection) onSection();
    else go(lastListUrl(s.path)); // back to the page (and filter) the list was left on
  };
  return (
    <div className="topbar">
      <nav className={`crumbs${deep ? ' has-back' : ''}`} aria-label="Breadcrumb">
        <ol>
          <li className="crumb-group">{s.group}</li>
          {deep ? (
            <>
              <li><a href={s.path} onClick={open}>{s.label}</a></li>
              <li className="crumb-here" aria-current="page" title={here}><span>{here}</span></li>
            </>
          ) : (
            <li className="crumb-here" aria-current="page">{s.label}</li>
          )}
        </ol>
        {deep && (
          <a className="crumb-back" href={s.path} onClick={open} aria-label={`Back to ${s.label}`}>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6.5 1.5L2 6l4.5 4.5" /></svg>
            {s.label}
          </a>
        )}
      </nav>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Page({ title, section, here, onSection, actions, sub, width = 'normal', children }: {
  title: string; section: SectionKey; here?: string; onSection?: () => void;
  actions?: ReactNode; sub?: ReactNode; width?: 'narrow' | 'normal' | 'wide'; children: ReactNode;
}) {
  return (
    <>
      <TopBar section={section} here={here} onSection={onSection} actions={actions} />
      <div className={`page page-${width}`}>
        <header className="page-head">
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </header>
        <div className="stack page-body">{children}</div>
      </div>
    </>
  );
}

export function Panel({ title, desc, actions, children, flush = false, id }: {
  title?: ReactNode; desc?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; id?: string;
}) {
  return (
    <section className="panel" id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <header className="panel-head">
          <div>{title && <h2>{title}</h2>}{desc && <p>{desc}</p>}</div>
          {actions && <div className="actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel-flush' : 'panel-body'}>{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="set-row">
      <div className="set-l">{htmlFor ? <label htmlFor={htmlFor}><b>{label}</b></label> : <b>{label}</b>}{hint && <span>{hint}</span>}</div>
      <div className="set-c">{children}</div>
    </div>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="set-row toggle-row">
      <div className="set-l"><b>{label}</b>{hint && <span>{hint}</span>}</div>
      <div className="set-c"><Switch checked={checked} label={label} disabled={disabled} onChange={onChange} /></div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function SaveBar({ dirty, busy = false, onSave, label = 'Save', note, error, disabled = false }: {
  dirty: boolean; busy?: boolean; onSave: () => void; label?: string; note?: ReactNode; error?: ReactNode; disabled?: boolean;
}) {
  return (
    <div className="save-bar">
      {error ? <span className="status err">{error}</span> : dirty ? <span className="status">Unsaved changes</span> : null}
      {note && <span className="hint">{note}</span>}
      <button type="button" className="btn primary" disabled={!dirty || busy || disabled} onClick={onSave}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

// Stacked label + control + hint, for narrow columns (editor side panel) where Row's two columns don't fit.
export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="kit-field">
      {htmlFor ? <label htmlFor={htmlFor} className="field-l">{label}</label> : <span className="field-l">{label}</span>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Loading({ error }: { error?: string }) {
  return error ? <p className="err-text" role="alert">{error}</p> : <p className="hint">Loading…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
