// Admin single-page app for sxingxian.com/admin.
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import './admin.css';
import { api } from './api';
import { ToastProvider } from './components/ui';
import { DialogProvider } from './components/dialog';
import { ThemeSwitch } from './theme';
import EntryList from './views/EntryList';
import EntryEditor from './views/EntryEditor';
import PageEditor from './views/PageEditor';
import Settings from './views/Settings';
import MediaLibrary from './views/MediaLibrary';
import WordPress from './views/WordPress';
import Account from './views/Account';
import Users from './views/Users';
import type { EntryKind } from '../lib/shared/types';

interface Me {
  user: { id: string; email: string; name: string; role: 'owner' | 'admin'; mustChangePassword: boolean; totpEnabled: boolean };
  email: string; wpBaseUrl: string; wpAdminUrl: string;
}

const LIST_ROUTES: Record<string, EntryKind> = { stories: 'post', journal: 'post', work: 'project', photos: 'gallery', film: 'film' };
const KINDS = new Set<EntryKind>(['post', 'project', 'gallery', 'film']);
const MORE_SECTIONS = new Set(['photos', 'film', 'pages', 'wordpress', 'account', 'users']);

const svg = (d: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{d}</svg>
);
const ICONS = {
  stories: svg(<><path d="M5 4h11l3 3v13H5z" /><path d="M9 10h7M9 14h7" /></>),
  work: svg(<><rect x="3.5" y="6" width="17" height="13" rx="2" /><path d="M9 6V4h6v2" /></>),
  media: svg(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-8 8.5" /></>),
  site: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>),
  more: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>,
};

function useRoute() {
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setLoc(window.location.pathname + window.location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setLoc(to);
    window.scrollTo(0, 0);
  }, []);
  return { loc, go };
}

// Phones: hide the bottom tab bar while the on-screen keyboard is up. iOS/Android keep fixed bars attached
// to the layout viewport, so once you scroll with the keyboard open the bar floats up over the text.
// "Keyboard up" = an editable field has focus and the visual viewport has shrunk (or focus just landed,
// while the keyboard is still sliding in). A hardware keyboard never shrinks the viewport, so the bar returns.
function useKeyboardOpen() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let focusAt = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const editable = (el: Element | null) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
      return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color', 'image'].includes(el.type);
    };
    const update = () => {
      const focused = editable(document.activeElement);
      const shrunk = vv ? vv.height < window.innerHeight - 100 : true;
      root.classList.toggle('kb-open', focused && (shrunk || Date.now() - focusAt < 900));
    };
    const onFocusIn = () => { focusAt = Date.now(); update(); clearTimeout(t); t = setTimeout(update, 950); };
    const onFocusOut = () => { clearTimeout(t); t = setTimeout(update, 60); };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    vv?.addEventListener('resize', update);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', update);
      clearTimeout(t);
      root.classList.remove('kb-open');
    };
  }, []);
}

export default function App() {
  const { loc, go } = useRoute();
  useKeyboardOpen();
  const [me, setMe] = useState<Me | null>(null);
  const loadMe = useCallback(() => { api.get<Me>('/api/admin/me').then(setMe).catch(() => {}); }, []);
  useEffect(loadMe, [loadMe]);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Sx-Admin': '1' } }).catch(() => {});
    window.location.replace('/admin/login');
  };

  const url = new URL(loc, window.location.origin);
  const parts = url.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  const section = parts[0] === 'journal' ? 'stories' : (parts[0] ?? 'stories');

  const mustChange = me?.user.mustChangePassword ?? false;
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [loc]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);

  let view;
  if (!me) {
    view = <div className="page"><p className="muted">Loading…</p></div>;
  } else if (mustChange || section === 'account') {
    view = <Account mustChangePassword={mustChange} onPasswordChanged={loadMe} />;
  } else if (section === 'users' && me.user.role === 'owner') {
    view = <Users meId={me.user.id} />;
  } else if (section in LIST_ROUTES) {
    view = <EntryList key={section} kind={LIST_ROUTES[section]} go={go} />;
  } else if (section === 'edit') {
    const id = parts[1] && parts[1] !== 'new' ? parts[1] : null;
    const k = url.searchParams.get('kind') as EntryKind | null;
    view = <EntryEditor key={id ?? `new-${k}`} id={id} kind={k && KINDS.has(k) ? k : 'post'} go={go} />;
  } else if (section === 'pages' && (parts[1] === 'cv' || parts[1] === 'about' || parts[1] === 'privacy')) {
    view = <PageEditor key={parts[1]} slug={parts[1]} />;
  } else if (section === 'media') {
    view = <MediaLibrary />;
  } else if (section === 'wordpress') {
    view = <WordPress wpBaseUrl={me?.wpBaseUrl ?? 'https://hey.sxingxian.com'} wpAdminUrl={me?.wpAdminUrl ?? 'https://hey.sxingxian.com/admin'} />;
  } else if (section === 'settings') {
    view = <Settings />;
  } else {
    view = <div className="page"><h1>Not found</h1></div>;
  }

  const tab = (to: string, label: string, active: boolean, icon: ReactNode) => (
    <a href={to} aria-current={active ? 'page' : undefined} onClick={(e: MouseEvent) => { e.preventDefault(); go(to); }}>{icon}{label}</a>
  );

  const link = (to: string, label: string, match: string) => (
    <a href={to} aria-current={section === match || (match === 'pages-' + parts[1]) ? 'page' : undefined}
      onClick={(e: MouseEvent) => { e.preventDefault(); go(to); }}>{label}</a>
  );

  return (
    <ToastProvider>
      <DialogProvider>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><b>sxingxian<span style={{ color: '#e0532f' }}>.</span></b><small>Studio · admin</small></div>
          <nav aria-label="Admin">
            <span className="group">Content</span>
            {link('/admin/stories', 'Stories', 'stories')}
            {link('/admin/work', 'Work', 'work')}
            {link('/admin/photos', 'Photos', 'photos')}
            {link('/admin/film', 'Film', 'film')}
            <span className="group">Pages</span>
            <a href="/admin/pages/cv" aria-current={section === 'pages' && parts[1] === 'cv' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go('/admin/pages/cv'); }}>CV</a>
            <a href="/admin/pages/about" aria-current={section === 'pages' && parts[1] === 'about' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go('/admin/pages/about'); }}>About</a>
            <a href="/admin/pages/privacy" aria-current={section === 'pages' && parts[1] === 'privacy' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go('/admin/pages/privacy'); }}>Privacy</a>
            <span className="group">Site</span>
            {link('/admin/media', 'Media', 'media')}
            {link('/admin/wordpress', 'WordPress', 'wordpress')}
            {link('/admin/settings', 'Settings', 'settings')}
            <span className="group">You</span>
            {link('/admin/account', 'Account', 'account')}
            {me?.user.role === 'owner' && link('/admin/users', 'Users', 'users')}
          </nav>
          <div className="foot who">
            <ThemeSwitch />
            {me ? <span>{me.user.name || me.user.email}<br /><span style={{ opacity: .7 }}>{me.user.role}{me.user.totpEnabled ? '' : ' · 2-step off'}</span></span> : null}
            <span><a href="/" target="_blank" rel="noopener">View site ↗</a> · <button type="button" className="linkbtn" onClick={signOut}>Sign out</button></span>
          </div>
        </aside>
        <div className="content">{view}</div>

        <nav className="tabbar" aria-label="Admin">
          {tab('/admin/stories', 'Stories', section === 'stories', ICONS.stories)}
          {tab('/admin/work', 'Work', section === 'work', ICONS.work)}
          {tab('/admin/media', 'Media', section === 'media', ICONS.media)}
          {tab('/admin/settings', 'Site', section === 'settings', ICONS.site)}
          <button type="button" aria-haspopup="dialog" aria-expanded={more} aria-current={MORE_SECTIONS.has(section) ? 'page' : undefined} onClick={() => setMore(true)}>{ICONS.more}More</button>
        </nav>

        {more && (
          <>
            <button type="button" className="sheet-back" aria-label="Close" onClick={() => setMore(false)} />
            <div className="sheet-panel" role="dialog" aria-modal="true" aria-label="More">
              <span className="grip" aria-hidden="true" />
              <div className="sheet-list">
                {[['/admin/photos', 'Photos', 'photos'], ['/admin/film', 'Film', 'film'], ['/admin/pages/cv', 'CV', 'cv'], ['/admin/pages/about', 'About', 'about'], ['/admin/pages/privacy', 'Privacy', 'privacy'],
                  ['/admin/wordpress', 'WordPress', 'wordpress'], ['/admin/account', 'Account', 'account'], ...(me?.user.role === 'owner' ? [['/admin/users', 'Users', 'users']] : [])]
                  .map(([to, label, key]) => (
                    <a key={to} href={to} aria-current={section === key || (section === 'pages' && parts[1] === key) ? 'page' : undefined}
                      onClick={(e) => { e.preventDefault(); go(to); }}>{label}</a>
                  ))}
              </div>
              <div style={{ margin: '16px 0 6px' }} className="lbl">Theme</div>
              <ThemeSwitch labels={{ system: 'System', light: 'Light', dark: 'Dark' }} />
              <div className="sheet-list" style={{ marginTop: 14 }}>
                <a href="/" target="_blank" rel="noopener">View site ↗</a>
                <button type="button" className="linkrow" onClick={signOut}>Sign out{me ? ` · ${me.user.email}` : ''}</button>
              </div>
            </div>
          </>
        )}
      </div>
      </DialogProvider>
    </ToastProvider>
  );
}
