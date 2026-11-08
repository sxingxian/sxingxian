import { useState } from 'react';

export function PasswordField({ label, value, onChange, autoComplete, hint, id, bare = false }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: 'current-password' | 'new-password'; hint?: string; id: string; bare?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      {bare ? <span className="sr-only">{label}</span> : label}
      <span className="pw-wrap">
        <input id={id} className="input" type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)} maxLength={256} required spellCheck={false} autoCapitalize="off" />
        <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
      </span>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Rough strength guide for the person typing. The server enforces the real rules. */
export function StrengthMeter({ value }: { value: string }) {
  const len = [...value].length;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/, /\s/].filter((r) => r.test(value)).length;
  const score = len === 0 ? 0 : len < 12 ? 1 : len < 16 ? (kinds >= 3 ? 3 : 2) : len < 20 ? (kinds >= 2 ? 4 : 3) : 4;
  const colours = ['transparent', '#c4552f', '#d99a2b', '#6a9a55', '#1e5b4f'];
  const words = ['', 'Too short', 'Okay', 'Good', 'Strong'];
  return (
    <div aria-live="polite">
      <div className="meter"><i style={{ width: `${score * 25}%`, background: colours[score] }} /></div>
      {value && <span className="hint">{words[score]}{len < 12 ? ` · ${12 - len} more character${12 - len === 1 ? '' : 's'}` : ''}</span>}
    </div>
  );
}

export async function authPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sx-Admin': '1' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** Only allow returning to an admin page on this site. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\s]/.test(raw)) return '/admin';
  let u: URL;
  try {
    u = new URL(raw, 'https://admin.invalid');
  } catch {
    return '/admin';
  }
  // The URL parser resolves "..", so check the normalised path, and that it stayed on this site.
  if (u.origin !== 'https://admin.invalid') return '/admin';
  const path = u.pathname;
  if (path !== '/admin' && !path.startsWith('/admin/')) return '/admin';
  if (path.startsWith('/admin/login') || path.startsWith('/admin/setup')) return '/admin';
  if (raw.toLowerCase().includes('%2e') || raw.includes('/./') || raw.includes('/../')) return '/admin';
  return path + u.search;
}
