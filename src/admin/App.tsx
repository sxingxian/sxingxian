// Admin single-page app for sxingxian.com/admin.
import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import './admin.css';
import { api } from './api';
import { ToastProvider } from './components/ui';
import { DialogProvider } from './components/dialog';
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

const LIST_ROUTES: Record<string, EntryKind> = { journal: 'post', work: 'project', photos: 'gallery', film: 'film' };
const KINDS = new Set<EntryKind>(['post', 'project', 'gallery', 'film']);

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

export default function App() {
  const { loc, go } = useRoute();
  const [me, setMe] = useState<Me | null>(null);
  const loadMe = useCallback(() => { api.get<Me>('/api/admin/me').then(setMe).catch(() => {}); }, []);
  useEffect(loadMe, [loadMe]);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Sx-Admin': '1' } }).catch(() => {});
    window.location.replace('/admin/login');
  };

  const url = new URL(loc, window.location.origin);
  const parts = url.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  const section = parts[0] ?? 'journal';

  const mustChange = me?.user.mustChangePassword ?? false;

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
  } else if (section === 'pages' && (parts[1] === 'cv' || parts[1] === 'about')) {
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
            {link('/admin/journal', 'Journal', 'journal')}
            {link('/admin/work', 'Work', 'work')}
            {link('/admin/photos', 'Photos', 'photos')}
            {link('/admin/film', 'Film', 'film')}
            <span className="group">Pages</span>
            <a href="/admin/pages/cv" aria-current={section === 'pages' && parts[1] === 'cv' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go('/admin/pages/cv'); }}>CV</a>
            <a href="/admin/pages/about" aria-current={section === 'pages' && parts[1] === 'about' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go('/admin/pages/about'); }}>About</a>
            <span className="group">Site</span>
            {link('/admin/media', 'Media', 'media')}
            {link('/admin/wordpress', 'WordPress', 'wordpress')}
            {link('/admin/settings', 'Settings', 'settings')}
            <span className="group">You</span>
            {link('/admin/account', 'Account', 'account')}
            {me?.user.role === 'owner' && link('/admin/users', 'Users', 'users')}
          </nav>
          <div className="foot who">
            {me ? <span>{me.user.name || me.user.email}<br /><span style={{ opacity: .7 }}>{me.user.role}{me.user.totpEnabled ? '' : ' · 2-step off'}</span></span> : null}
            <span><a href="/" target="_blank" rel="noopener">View site ↗</a> · <button type="button" className="linkbtn" onClick={signOut}>Sign out</button></span>
          </div>
        </aside>
        <div className="content">{view}</div>
      </div>
      </DialogProvider>
    </ToastProvider>
  );
}
