// Theme preference shared with the public site (localStorage "sx-theme"): system | light | dark.
import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'sx-theme';

function read(): ThemePref {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: still apply for this page */
  }
  if (pref === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', pref);
  window.dispatchEvent(new Event('sx-theme'));
}

export function useThemePref(): ThemePref {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => {
    const on = () => setPref(read());
    window.addEventListener('sx-theme', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('sx-theme', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return pref;
}

export function ThemeSwitch({ labels = { system: 'Auto', light: 'Light', dark: 'Dark' } }: { labels?: Record<ThemePref, string> }) {
  const pref = useThemePref();
  return (
    <div className="theme-seg" role="radiogroup" aria-label="Theme">
      {(['system', 'light', 'dark'] as ThemePref[]).map((p) => (
        <button key={p} type="button" role="radio" aria-checked={pref === p} onClick={() => setTheme(p)}>{labels[p]}</button>
      ))}
    </div>
  );
}
