// Types and defaults shared by the public site, the API and the admin app.
// This file must stay free of server-only imports (no env, no db).

export type EntryKind = 'post' | 'project' | 'gallery' | 'film';
export type EntryStatus = 'draft' | 'published';
export type MediaProvider = 'r2' | 'nas' | 'b2' | 'youtube' | 'vimeo';

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  slug: string;
  dek: string;
  topic: string;
  body: DocNode;
  cover_media_id: string | null;
  video_url: string;
  meta: Record<string, unknown>;
  read_minutes: number;
  status: EntryStatus;
  is_public: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page {
  slug: 'cv' | 'about' | 'privacy';
  title: string;
  body: DocNode;
  noindex: boolean;
  updated_at: string;
}

export interface MediaItem {
  id: string;
  provider: MediaProvider;
  object_key: string;
  embed_id: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  filename: string;
  created_at: string;
  wm_key?: string | null;
  wm_mime?: string | null;
  wm_sig?: string | null;
}

export interface ExternalPost {
  wp_id: number;
  slug: string;
  title: string;
  excerpt: string;
  url: string;
  topic: string;
  image_url: string;
  read_minutes: number;
  published_at: string;
  modified_at: string;
  show_on_main: boolean;
  removed_at: string | null;
}

// ---------- settings ----------

export interface SectionsSetting {
  work: boolean;
  photos: boolean;
  film: boolean;
  cv: boolean;
  about: boolean;
}

export interface FeaturedSetting {
  mode: 'latest' | 'manual';
  entryId: string | null;
}

export interface FooterLink {
  label: string;
  url: string;
}
export interface FooterSetting {
  about: string;
  columns: { heading: string; links: FooterLink[] }[];
  bottomLine: string;
  showRss: boolean;
  showBuiltOn: boolean;
}

export interface WordPressSetting {
  autoShow: boolean;
  includeInRss: boolean;
  hideWhenDown: boolean;
  categoryMap: Record<string, string>;
}

export interface SiteSetting {
  title: string;
  tagline: string;
  topics: string[];
}

/** Google AdSense. Ads only run when enabled with a valid publisher ID, never in the admin or on CV, About and Privacy. */
export interface AdsSetting {
  enabled: boolean;
  client: string; // ca-pub-…
  homeSlot: string; // display ad unit on the home page ('' = none)
  articleSlot: string; // display ad unit at the end of posts and entries ('' = none)
}

export type WatermarkPosition = 'br' | 'bl' | 'center' | 'tiled';

/** Photo protection: a watermark baked into public copies, and save deterrents on the public site. */
export interface ProtectionSetting {
  watermark: boolean;
  text: string;
  position: WatermarkPosition;
  size: 's' | 'm' | 'l';
  opacity: number; // 0.1 – 0.7
  blockSave: boolean; // right-click, drag, long-press save; direct-open and hotlink refusal
}

export interface SettingsMap {
  site: SiteSetting;
  sections: SectionsSetting;
  featured: FeaturedSetting;
  footer: FooterSetting;
  wordpress: WordPressSetting;
  ads: AdsSetting;
  protection: ProtectionSetting;
}
export type SettingKey = keyof SettingsMap;

export const DEFAULT_SETTINGS: SettingsMap = {
  site: {
    title: 'sxingxian',
    tagline: 'journal',
    topics: ['Engineering', 'Homelab', 'Photography', 'Essays', 'Notes'],
  },
  sections: { work: true, photos: true, film: true, cv: true, about: true },
  featured: { mode: 'latest', entryId: null },
  footer: {
    about: 'Engineer and photographer in Singapore, writing about building things and noticing things.',
    columns: [
      { heading: 'Archive', links: [{ label: 'All posts', url: '/journal' }] },
      {
        heading: 'Elsewhere',
        links: [
          { label: 'CV', url: '/cv' },
          { label: 'GitHub ↗', url: 'https://github.com/sxingxian' },
        ],
      },
      { heading: 'Follow', links: [{ label: 'RSS feed', url: '/rss.xml' }] },
    ],
    bottomLine: '© {year} sxingxian. Words and photographs are my own.',
    showRss: true,
    showBuiltOn: true,
  },
  wordpress: { autoShow: false, includeInRss: true, hideWhenDown: true, categoryMap: {} },
  ads: { enabled: false, client: '', homeSlot: '', articleSlot: '' },
  protection: { watermark: false, text: '© sxingxian', position: 'br', size: 'm', opacity: 0.4, blockSave: true },
};

export const SECTION_LABELS: Record<keyof SectionsSetting, string> = {
  work: 'Work',
  photos: 'Photos',
  film: 'Film',
  cv: 'CV',
  about: 'About',
};

export const KIND_LABELS: Record<EntryKind, string> = {
  post: 'Journal post',
  project: 'Work',
  gallery: 'Photo gallery',
  film: 'Film',
};

export const KIND_PATH: Record<EntryKind, string> = {
  post: '/journal',
  project: '/work',
  gallery: '/photos',
  film: '/film',
};
