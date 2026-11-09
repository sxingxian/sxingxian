// SERVER-ONLY. Data assembly for public pages.
import { sql } from './db';
import { getPublicEntryById, getSettings, listPublicEntries, listVisibleExternalPosts } from './repo';
import type { Entry, SectionsSetting } from '../shared/types';
import { KIND_PATH, SECTION_LABELS } from '../shared/types';

export interface FeedItem {
  key: string;
  source: 'native' | 'wordpress';
  title: string;
  dek: string;
  topic: string;
  url: string;
  external: boolean;
  date: string;
  readMinutes: number;
  image: { kind: 'media'; id: string } | { kind: 'url'; url: string } | null;
}

// ---- WordPress visibility (cached briefly per isolate) ----
let wpCache: { at: number; visible: boolean } | null = null;

export async function isWordPressVisible(): Promise<boolean> {
  if (wpCache && Date.now() - wpCache.at < 20_000) return wpCache.visible;
  const [{ wordpress }, rows] = await Promise.all([getSettings(['wordpress']), sql()`SELECT status FROM sources WHERE id = 'wordpress'`]);
  const down = rows[0]?.status === 'down';
  const visible = !(down && wordpress.hideWhenDown);
  wpCache = { at: Date.now(), visible };
  return visible;
}

export function entryToFeed(e: Entry): FeedItem {
  return {
    key: `n:${e.id}`,
    source: 'native',
    title: e.title,
    dek: e.dek,
    topic: e.topic,
    url: `${KIND_PATH[e.kind]}/${e.slug}`,
    external: false,
    date: String(e.published_at ?? e.created_at),
    readMinutes: e.read_minutes,
    image: e.cover_media_id ? { kind: 'media', id: e.cover_media_id } : null,
  };
}

/** Stories feed: native posts + visible WordPress posts, newest first. */
export async function getFeed(opts: { topic?: string; limit?: number; excludeId?: string } = {}): Promise<FeedItem[]> {
  const limit = opts.limit ?? 12;
  const [native, wpVisible] = await Promise.all([
    listPublicEntries('post', { topic: opts.topic, limit: limit + 1 }),
    isWordPressVisible(),
  ]);
  const external = wpVisible ? await listVisibleExternalPosts({ topic: opts.topic, limit }) : [];
  const items: FeedItem[] = [
    ...native.filter((e) => e.id !== opts.excludeId).map(entryToFeed),
    ...external.map<FeedItem>((p) => ({
      key: `w:${p.wp_id}`,
      source: 'wordpress',
      title: p.title,
      dek: p.excerpt,
      topic: p.topic,
      url: p.url,
      external: true,
      date: String(p.published_at),
      readMinutes: p.read_minutes,
      image: p.image_url ? { kind: 'url', url: p.image_url } : null,
    })),
  ];
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return items.slice(0, limit);
}

/** Featured post: the one chosen in admin if it is still public, otherwise the latest native post. */
export async function getFeatured(): Promise<Entry | null> {
  const { featured } = await getSettings(['featured']);
  if (featured.mode === 'manual' && featured.entryId) {
    const chosen = await getPublicEntryById(featured.entryId);
    if (chosen && chosen.kind === 'post') return chosen;
  }
  const [latest] = await listPublicEntries('post', { limit: 1 });
  return latest ?? null;
}

export interface NavItem {
  href: string;
  label: string;
}

export function navItems(sections: SectionsSetting): NavItem[] {
  const items: NavItem[] = [{ href: '/', label: 'Stories' }];
  const map: [keyof SectionsSetting, string][] = [
    ['work', '/work'],
    ['photos', '/photos'],
    ['film', '/film'],
    ['cv', '/cv'],
    ['about', '/about'],
  ];
  for (const [key, href] of map) if (sections[key]) items.push({ href, label: SECTION_LABELS[key] });
  return items;
}
