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
  /** First topic, kept for the previous release and rollbacks. Always equal to topics[0] ?? ''. */
  topic: string;
  /** Up to MAX_ENTRY_TOPICS topics, in the order the owner picked them. */
  topics: string[];
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

/**
 * Featured stories: the rotating stories at the top of the home page.
 * entryIds = chosen stories (none = the latest story). order 'date' = newest first, 'custom' = the order in entryIds.
 * mode/entryId are the previous release's shape: still read (an old saved value becomes entryIds = [entryId])
 * and still written, so rolling back keeps the first featured story.
 */
export interface FeaturedSetting {
  entryIds: string[];
  order: 'date' | 'custom';
  mode?: 'latest' | 'manual';
  entryId?: string | null;
}

export const MAX_FEATURED = 8;
/** Seconds between featured stories on the home page. */
export const FEATURED_INTERVAL_S = 8;

/** The chosen featured story ids, from the current or the previous release's setting. */
export function featuredIds(f: Partial<FeaturedSetting> | null | undefined): string[] {
  if (!f) return [];
  if (Array.isArray(f.entryIds) && f.entryIds.length) return [...new Set(f.entryIds.filter((x) => typeof x === 'string'))].slice(0, MAX_FEATURED);
  if (f.mode === 'manual' && typeof f.entryId === 'string') return [f.entryId];
  return [];
}

export interface FooterLink {
  label: string;
  url: string;
  /** Open in a new tab (target=_blank, rel=noopener noreferrer). */
  newTab?: boolean;
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
  /** WordPress site address (https, public). Empty = the WP_BASE_URL set in Cloudflare. Set only via the address action. */
  baseUrl?: string;
}

export interface SiteSetting {
  title: string;
  tagline: string;
  /** Story topics (home page and /story filters). */
  topics: string[];
}

/** Topic lists for the other sections. Story topics live in SiteSetting.topics. */
export interface TopicsSetting {
  work: string[];
  photos: string[];
  film: string[];
}

export const MAX_ENTRY_TOPICS = 3;
export const MAX_LIST_TOPICS = 12;
export const MAX_TOPIC_LEN = 30;

/** Which Settings → Topics list an entry kind uses ('stories' = SiteSetting.topics). */
export const TOPIC_LIST: Record<EntryKind, 'stories' | keyof TopicsSetting> = {
  post: 'stories',
  project: 'work',
  gallery: 'photos',
  film: 'film',
};

/** Names for the lists in the admin: 'Story topics', 'Photo topics', … */
export const TOPIC_LIST_LABEL: Record<'stories' | keyof TopicsSetting, string> = {
  stories: 'Story',
  work: 'Work',
  photos: 'Photo',
  film: 'Film',
};

/** Public label for an entry's topics: 'Travel · Photography'. */
export function topicLabel(topics: readonly string[] | null | undefined): string {
  return (topics ?? []).filter(Boolean).join(' · ');
}

/** Clean a list of topics: trimmed, non-empty, capped in length, de-duplicated (case-insensitive), capped in count. */
export function cleanTopics(raw: unknown, max: number = MAX_ENTRY_TOPICS): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const t = v.trim().replace(/\s+/g, ' ').slice(0, MAX_TOPIC_LEN);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
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
  logo: boolean; // draw the uploaded logo to the left of the text
  logoTint: 'original' | 'white';
  /** First 16 hex chars of the logo's SHA-256, or null when none is uploaded. Set by the server only. */
  logoHash: string | null;
}

export interface SettingsMap {
  site: SiteSetting;
  topics: TopicsSetting;
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
    tagline: 'stories',
    topics: ['Engineering', 'Homelab', 'Photography', 'Essays', 'Notes'],
  },
  topics: { work: [], photos: [], film: [] },
  sections: { work: true, photos: true, film: true, cv: true, about: true },
  featured: { entryIds: [], order: 'date' },
  footer: {
    about: 'Engineer and photographer in Singapore, writing about building things and noticing things.',
    columns: [
      { heading: 'Archive', links: [{ label: 'All stories', url: '/story' }] },
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
  protection: { watermark: false, text: '© sxingxian', position: 'br', size: 'm', opacity: 0.4, blockSave: true, logo: true, logoTint: 'original', logoHash: null },
};

export const SECTION_LABELS: Record<keyof SectionsSetting, string> = {
  work: 'Work',
  photos: 'Photos',
  film: 'Film',
  cv: 'CV',
  about: 'About',
};

export const KIND_LABELS: Record<EntryKind, string> = {
  post: 'Story',
  project: 'Work',
  gallery: 'Photo gallery',
  film: 'Film',
};

export const KIND_PATH: Record<EntryKind, string> = {
  post: '/story',
  project: '/work',
  gallery: '/photos',
  film: '/film',
};

// ---------- series ----------

export interface Series {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** How many parts are planned (optional). Drives the progress bar. */
  planned_parts: number | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

/** Admin list row: a series plus how many of its stories are published / drafts. */
export interface SeriesAdminRow extends Series {
  published: number;
  drafts: number;
}

export const MAX_SERIES_PART = 99;
