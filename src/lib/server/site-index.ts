// SERVER-ONLY. What sitemap.xml and llms.txt list: every public page a visitor can open, nothing else.
// Respects the section switches and each page's "hide from search engines" setting. WordPress posts are
// left out (they live on their own site, which has its own sitemap).
import { getPage, getSettings, listPublicIndex } from './repo';
import { listPublicSeries } from './series';
import { KIND_PATH, type EntryKind, type SectionsSetting } from '../shared/types';

export interface IndexedUrl {
  path: string;
  title: string;
  description?: string;
  lastmod?: string;
  image?: string; // media id
  group: 'Pages' | 'Stories' | 'Work' | 'Photos' | 'Film' | 'Series';
}

const KIND_SECTION: Record<EntryKind, keyof SectionsSetting | null> = { post: null, project: 'work', gallery: 'photos', film: 'film' };
const KIND_GROUP: Record<EntryKind, IndexedUrl['group']> = { post: 'Stories', project: 'Work', gallery: 'Photos', film: 'Film' };

export async function siteIndex(): Promise<IndexedUrl[]> {
  const [{ sections }, entries, series, cv, about, privacy] = await Promise.all([
    getSettings(['sections']),
    listPublicIndex(),
    listPublicSeries(100).catch(() => []),
    getPage('cv'), getPage('about'), getPage('privacy'),
  ]);
  const on = (k: EntryKind) => { const s = KIND_SECTION[k]; return !s || sections[s]; };
  const newest = (k: EntryKind) => entries.find((e) => e.kind === k)?.updated_at;
  const urls: IndexedUrl[] = [{ path: '/', title: 'Home', group: 'Pages', lastmod: entries[0]?.updated_at }];
  const lists: [EntryKind, string, string][] = [['post', '/story', 'All stories'], ['project', '/work', 'Work'], ['gallery', '/photos', 'Photos'], ['film', '/film', 'Film']];
  for (const [k, path, title] of lists) if (on(k)) urls.push({ path, title, group: 'Pages', lastmod: newest(k) });
  if (series.length) urls.push({ path: '/series', title: 'Series', group: 'Pages' });
  for (const [page, enabled] of [[cv, sections.cv], [about, sections.about], [privacy, true]] as const) {
    if (page && enabled && !page.noindex) urls.push({ path: `/${page.slug}`, title: page.title || page.slug, group: 'Pages', lastmod: page.updated_at });
  }
  for (const s of series) urls.push({ path: `/series/${s.slug}`, title: s.title, description: s.description, lastmod: s.updated_at, image: s.cover_media_id ?? undefined, group: 'Series' });
  for (const e of entries) {
    if (!on(e.kind)) continue;
    urls.push({ path: `${KIND_PATH[e.kind]}/${e.slug}`, title: e.title, description: e.dek, lastmod: e.updated_at, image: e.cover_media_id ?? undefined, group: KIND_GROUP[e.kind] });
  }
  return urls;
}
