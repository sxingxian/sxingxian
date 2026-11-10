// Admin sections, as grouped in the sidebar. Breadcrumbs are built from this, so every page
// shows the same trail: Group / Section / Item.
import { createContext, useContext } from 'react';
import type { EntryKind } from '../lib/shared/types';

export type SectionKey =
  | 'stories' | 'series' | 'work' | 'photos' | 'film'
  | 'cv' | 'about' | 'privacy'
  | 'media' | 'wordpress' | 'settings'
  | 'account' | 'users';

export const SECTIONS: Record<SectionKey, { group: string; label: string; path: string }> = {
  stories: { group: 'Content', label: 'Stories', path: '/admin/stories' },
  series: { group: 'Content', label: 'Series', path: '/admin/series' },
  work: { group: 'Content', label: 'Work', path: '/admin/work' },
  photos: { group: 'Content', label: 'Photos', path: '/admin/photos' },
  film: { group: 'Content', label: 'Film', path: '/admin/film' },
  cv: { group: 'Pages', label: 'CV', path: '/admin/pages/cv' },
  about: { group: 'Pages', label: 'About', path: '/admin/pages/about' },
  privacy: { group: 'Pages', label: 'Privacy', path: '/admin/pages/privacy' },
  media: { group: 'Site', label: 'Media', path: '/admin/media' },
  wordpress: { group: 'Site', label: 'WordPress', path: '/admin/wordpress' },
  settings: { group: 'Site', label: 'Settings', path: '/admin/settings' },
  account: { group: 'You', label: 'Account', path: '/admin/account' },
  users: { group: 'You', label: 'Users', path: '/admin/users' },
};

/** The list section an entry kind belongs to. */
export const KIND_SECTION: Record<EntryKind, SectionKey> = { post: 'stories', project: 'work', gallery: 'photos', film: 'film' };

/** In-app navigation (history.pushState), provided by App. Falls back to a normal page load. */
export const NavContext = createContext<(to: string) => void>((to) => window.location.assign(to));
export const useGo = () => useContext(NavContext);
