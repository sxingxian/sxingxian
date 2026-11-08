// Modern date + time picker (popover). Value is an ISO string or null; shown in local time.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

interface Props {
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  label?: string;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function fmt(d: Date): string {
  return d.toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function relative(d: Date): string {
  const diff = d.getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (Math.abs(diff) < 60_000) return 'now';
  if (diff > 0) return days >= 1 ? `in ${days} day${days === 1 ? '' : 's'}` : `in ${Math.max(1, Math.round(diff / 3_600_000))} h`;
  return '';
}

/** 42 cells (6 weeks), Monday first. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

export default function DateTimePicker({ value, onChange, placeholder = 'When you publish', label = 'Publish date' }: Props) {
  const current = value ? new Date(value) : null;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const d = current ?? new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [focusDay, setFocusDay] = useState<Date>(() => current ?? new Date());
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const tz = useMemo(() => new Intl.DateTimeFormat('en-SG', { timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '', []);

  const hours = current ? current.getHours() : 9;
  const minutes = current ? current.getMinutes() : 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [open, focusDay, view]);

  const openPicker = () => {
    const d = current ?? new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setFocusDay(d);
    setOpen(true);
  };

  const commit = (day: Date, h = hours, m = minutes) => {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
    onChange(d.toISOString());
  };

  const moveFocus = (days: number) => {
    const d = new Date(focusDay.getFullYear(), focusDay.getMonth(), focusDay.getDate() + days);
    setFocusDay(d);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const onGridKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) { e.preventDefault(); moveFocus(map[e.key]); }
    else if (e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setFocusDay(new Date(d.getFullYear(), d.getMonth(), Math.min(focusDay.getDate(), 28)));
  };

  const setTime = (h: number, m: number) => commit(current ?? focusDay, h, m);
  const today = new Date();
  const days = monthGrid(view.y, view.m);
  const monthName = new Date(view.y, view.m, 1).toLocaleString('en-SG', { month: 'long', year: 'numeric' });
  const rel = current ? relative(current) : '';

  return (
    <div className="dtp" ref={root}>
      <button ref={trigger} type="button" className={`dtp-trigger${current ? '' : ' empty'}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={popId}
        aria-label={`${label}: ${current ? fmt(current) : placeholder}`} onClick={() => (open ? setOpen(false) : openPicker())}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
        <span className="dtp-text">{current ? fmt(current) : placeholder}</span>
        {rel && <span className="dtp-rel">{rel}</span>}
      </button>

      {open && (
        <div id={popId} className="dtp-pop" role="dialog" aria-label={label}>
          <div className="dtp-head">
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <span className="dtp-month" aria-live="polite">{monthName}</span>
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          </div>
          <div className="dtp-week" aria-hidden="true">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="dtp-grid" role="grid" ref={grid} onKeyDown={onGridKey}>
            {days.map((d) => {
              const outside = d.getMonth() !== view.m;
              const selected = current ? sameDay(d, current) : false;
              const focused = sameDay(d, focusDay);
              return (
                <button key={d.toISOString()} type="button" role="gridcell" tabIndex={focused ? 0 : -1}
                  className={['dtp-day', outside && 'out', selected && 'sel', sameDay(d, today) && 'today'].filter(Boolean).join(' ')}
                  aria-selected={selected} aria-label={d.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  onClick={() => { setFocusDay(d); commit(d); }}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="dtp-time">
            <span className="dtp-label">Time</span>
            <select className="select" aria-label="Hour" value={hours} onChange={(e) => setTime(Number(e.target.value), minutes)}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span aria-hidden="true">:</span>
            <select className="select" aria-label="Minute" value={minutes} onChange={(e) => setTime(hours, Number(e.target.value))}>
              {[...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
            </select>
            <span className="dtp-tz">{tz}</span>
          </div>

          <div className="dtp-foot">
            <button type="button" className="btn small" onClick={() => { onChange(new Date().toISOString()); setOpen(false); }}>Now</button>
            <button type="button" className="btn small" onClick={() => { const t = new Date(); t.setDate(t.getDate() + 1); commit(t, 9, 0); }} title="Tomorrow 9:00">Tomorrow</button>
            <span style={{ flex: 1 }} />
            {current && <button type="button" className="btn small" onClick={() => { onChange(null); setOpen(false); }}>Clear</button>}
            <button type="button" className="btn small primary" onClick={() => { if (!current) commit(focusDay); setOpen(false); trigger.current?.focus(); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
