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
  /** Admin list only: a live entry has edits saved privately that aren't live yet. */
  has_edits?: boolean;
}

/** Edits to a live entry, saved privately until Update (stored in entry_edits). */
export interface EntryEdits {
  title: string;
  slug: string;
  dek: string;
  topic: string;
  topics: string[];
  body: DocNode;
  cover_media_id: string | null;
  video_url: string;
  meta: Record<string, unknown>;
  read_minutes: number;
}

/** The editable standalone pages. */
export const PAGE_SLUGS = ['cv', 'about', 'privacy', 'contact'] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

export interface Page {
  slug: PageSlug;
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
  /** The Contact page, linked from the footer (not the menu). */
  contact: boolean;
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
  /** Image used for any story, WordPress post, work item or film without its own picture (media id). */
  defaultCoverId?: string | null;
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

/** The areas of the public site where ads can be switched on or off. Everything else never has ads. */
export const AD_PLACES = ['story', 'home', 'lists', 'photos', 'film', 'work'] as const;
export type AdPlace = (typeof AD_PLACES)[number];
export const AD_PLACE_LABELS: Record<AdPlace, { label: string; hint: string }> = {
  story: { label: 'Story pages', hint: 'One story, read top to bottom' },
  home: { label: 'Home page', hint: 'Mostly links to stories' },
  lists: { label: 'Story lists', hint: 'All stories and series pages' },
  photos: { label: 'Photos', hint: 'The photo list and each gallery' },
  film: { label: 'Film', hint: 'The film list and each film' },
  work: { label: 'Work', hint: 'The work list and each project' },
};
export const DEFAULT_AD_PLACES: Record<AdPlace, boolean> = { story: true, home: false, lists: false, photos: false, film: false, work: false };
/** With "skip short pages" on, an entry needs at least this many words of its own text to carry ads. */
export const AD_MIN_WORDS = 300;

/** Google AdSense. Ads only run when enabled with a valid publisher ID, only in the places switched on,
 *  and never in the admin, on CV, About, Privacy, Contact, the sponsor pages or error pages. */
export interface AdsSetting {
  enabled: boolean;
  client: string; // ca-pub-…
  homeSlot: string; // display ad unit on the home page ('' = none)
  articleSlot: string; // display ad unit at the end of posts and entries ('' = none)
  /** Where ads may show. A place missing from a saved value uses DEFAULT_AD_PLACES. */
  places?: Partial<Record<AdPlace, boolean>>;
  /** No ads on entries with fewer than AD_MIN_WORDS words (thin pages). Missing = on. */
  skipShort?: boolean;
}

/** The Ads tab's checklist (GET /api/admin/ads/readiness). Counts cover live entries only. */
export interface AdReadiness {
  privacy: 'ok' | 'hidden' | 'missing';
  about: 'ok' | 'off' | 'missing';
  contact: 'ok' | 'off' | 'missing';
  adsTxt: boolean;
  entries: { total: number; noSummary: number; noAlt: number; short: number };
  /** The entries behind the two counts above, newest first, at most READINESS_LIST_MAX each. */
  lists: { noSummary: ReadinessEntry[]; noAlt: ReadinessEntry[] };
}

/** One live entry in a checklist list. `missing` = photos without a description (noAlt list only). */
export interface ReadinessEntry {
  id: string;
  kind: EntryKind;
  title: string;
  published_at: string;
  missing?: number;
  /** Has saved edits that aren't live yet (they may already fix it: press Update in the editor). */
  pending: boolean;
}
export const READINESS_LIST_MAX = 200;

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

/** A Telegram channel the bot posts to, and which kinds of entry it gets. */
export interface TelegramChannel {
  chat: string; // "@name", or "-100…" for a private channel
  title: string;
  kinds: EntryKind[];
  /** Only entries published after this are posted here (a new channel doesn't get old posts). */
  addedAt: string;
}

/** Telegram announcements. The bot token is NOT here: it is stored encrypted in telegram_bot (server only). */
export interface TelegramSetting {
  channels: TelegramChannel[];
  /** Default message, in simple markdown, with {title} {excerpt} {topics} {series} fill-ins. */
  template: string;
  attachImage: boolean;
  /** Post without a notification sound (Telegram's disable_notification). Each entry can change it. */
  silent: boolean;
  buttons: Record<EntryKind, string>;
}

/** One-time sponsor. Amounts are in cents (SGD). `methods` is kept by the server: which providers are connected.
 *  PayPal is either a PayPal.Me link (`paypalMode: 'me'`, no keys; payments can't be confirmed) or the business API. */
export interface SponsorSetting {
  enabled: boolean;
  /** The card at the end of a page; `cardKinds` says which kinds of page get it. */
  storyCard: boolean;
  cardKinds: EntryKind[];
  paypalMode: 'me' | 'api';
  paypalMe: string;
  footerLink: boolean;
  amounts: number[];
  defaultAmount: number;
  allowCustom: boolean;
  min: number;
  max: number;
  cardTitle: string;
  cardText: string;
  pageTitle: string;
  pageText: string;
  methods: { stripe: boolean; paypal: boolean };
}

/** Read count on each story page ("1.2k reads"), from the same daily totals as Most read. */
export const READS_MINIMUMS = [1, 25, 50, 100] as const;
export interface ReadsSetting {
  show: boolean;
  /** Hidden until a story has at least this many reads, so new stories don't show "3 reads". */
  minimum: (typeof READS_MINIMUMS)[number];
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
  telegram: TelegramSetting;
  sponsor: SponsorSetting;
  reads: ReadsSetting;
}
export type SettingKey = keyof SettingsMap;

export const DEFAULT_SETTINGS: SettingsMap = {
  site: {
    title: 'sxingxian',
    tagline: 'stories',
    topics: ['Engineering', 'Homelab', 'Photography', 'Essays', 'Notes'],
    defaultCoverId: null,
  },
  topics: { work: [], photos: [], film: [] },
  sections: { work: true, photos: true, film: true, cv: true, about: true, contact: false },
  reads: { show: true, minimum: 50 },
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
  ads: { enabled: false, client: '', homeSlot: '', articleSlot: '', places: { ...DEFAULT_AD_PLACES }, skipShort: true },
  protection: { watermark: false, text: '© sxingxian', position: 'br', size: 'm', opacity: 0.4, blockSave: true, logo: true, logoTint: 'original', logoHash: null },
  telegram: {
    channels: [],
    template: '**{title}**\n\n{excerpt}',
    attachImage: true,
    silent: false,
    buttons: { post: 'Read the story', project: 'See the work', gallery: 'See the photos', film: 'Watch the film' },
  },
  sponsor: {
    enabled: true,
    storyCard: true,
    cardKinds: ['post', 'project', 'gallery', 'film'],
    paypalMode: 'me',
    paypalMe: '',
    footerLink: true,
    amounts: [500, 1000, 2000],
    defaultAmount: 1000,
    allowCustom: true,
    min: 300,
    max: 50000,
    cardTitle: 'Enjoyed {this}?',
    cardText: 'Everything here is free to read. If it was worth something to you, a one-time sponsor keeps the next one coming.',
    pageTitle: 'Sponsor the next story',
    pageText: 'Stories, photographs and films here are free, with no paywall. A one-time sponsor pays for the hosting and the time to make the next one. Thank you.',
    methods: { stripe: false, paypal: false },
  },
};

/** How PayPal works right now: a PayPal.Me link, the business API, or not at all. */
export function paypalVia(s: SponsorSetting): 'me' | 'api' | null {
  if (s.paypalMode === 'me') return /^[A-Za-z0-9]{1,20}$/.test(s.paypalMe ?? '') ? 'me' : null;
  return s.methods.paypal ? 'api' : null;
}

/** Whether the sponsor page, card and link show: switched on and at least one way to pay set up. */
export function sponsorLive(s: SponsorSetting): boolean {
  return s.enabled && (s.methods.stripe || paypalVia(s) !== null);
}

/** "this story", "this work", "these photos", "this film": fills {this} in the card's heading. */
export const KIND_THIS: Record<EntryKind, string> = { post: 'this story', project: 'this work', gallery: 'these photos', film: 'this film' };
/** "Back to the story" and friends, after paying or cancelling. */
export const KIND_BACK: Record<EntryKind, string> = { post: 'Back to the story', project: 'Back to the work', gallery: 'Back to the photos', film: 'Back to the film' };

/** The card's heading for one kind of page. A heading saved before {this} existed still reads right. */
export function sponsorCardTitle(s: SponsorSetting, kind: EntryKind): string {
  const t = s.cardTitle.trim() === 'Enjoyed this story?' ? 'Enjoyed {this}?' : s.cardTitle;
  return t.replaceAll('{this}', KIND_THIS[kind]);
}

export const SECTION_LABELS: Record<keyof SectionsSetting, string> = {
  work: 'Work',
  photos: 'Photos',
  film: 'Film',
  cv: 'CV',
  about: 'About',
  contact: 'Contact',
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

/** Admin list row: a series plus how many of its stories are published (live) / scheduled / drafts. */
export interface SeriesAdminRow extends Series {
  published: number;
  scheduled: number;
  drafts: number;
}

export const MAX_SERIES_PART = 99;
