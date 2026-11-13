// SERVER-ONLY. Where Google AdSense may run.
//
// Three layers, checked in this order, and all on the server (the AdSense script is not even sent to a page
// that fails one, so Auto ads can't appear there either):
//   1. Locked: pages that never carry ads, whatever the settings say.
//   2. Places: the areas the owner switched on in Settings → Ads. A path that belongs to no place gets no ads.
//   3. The page itself: no ads on error pages, pages hidden from search engines, or (with "skip short pages")
//      entries with too little text of their own.
import { getSetting } from './repo';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE } from '../shared/safe';
import { AD_MIN_WORDS, AD_PLACES, DEFAULT_AD_PLACES, type AdPlace, type AdsSetting } from '../shared/types';

// Never: the admin, the API, the pages that stand for you professionally or legally, and the sponsor pages
// (ads next to payment buttons look untrustworthy and pull clicks away from paying). Not switchable.
export const NO_ADS = ['/admin', '/api', '/cv', '/about', '/privacy', '/contact', '/sponsor', '/media', '/partials', '/journal', '/rss.xml', '/ads.txt', '/sitemap.xml', '/llms.txt'];

const clean = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path) || '/';

export function adsLocked(path: string): boolean {
  const p = clean(path);
  return NO_ADS.some((x) => p === x || p.startsWith(`${x}/`));
}

/** Which switch governs this path, and whether it is one entry (true) or a list (false). Null = never ads. */
export function adPlace(path: string): { place: AdPlace; entry: boolean } | null {
  if (adsLocked(path)) return null;
  const parts = clean(path).split('/').filter(Boolean);
  if (parts.length === 0) return { place: 'home', entry: false };
  if (parts.length > 2) return null;
  const entry = parts.length === 2;
  switch (parts[0]) {
    case 'story': return entry ? { place: 'story', entry: true } : { place: 'lists', entry: false };
    case 'series': return { place: 'lists', entry: false };
    case 'photos': return { place: 'photos', entry };
    case 'film': return { place: 'film', entry };
    case 'work': return { place: 'work', entry };
    default: return null;
  }
}

/** The switches with defaults filled in. Only real booleans count: anything else falls back to the default. */
export function adPlaces(ads: Pick<AdsSetting, 'places'>): Record<AdPlace, boolean> {
  const out = { ...DEFAULT_AD_PLACES };
  for (const k of AD_PLACES) {
    const v = ads.places?.[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export interface AdPageFacts {
  /** Words of the entry's own text, for entry pages. */
  words?: number | null;
  /** The page is an error page or is hidden from search engines. */
  blocked?: boolean;
}

/** Whether ads may run on this path with these settings. Fails closed: anything unknown means no ads. */
export function adsAllowedOn(path: string, ads: Pick<AdsSetting, 'places' | 'skipShort'>, page: AdPageFacts = {}): boolean {
  const at = adPlace(path);
  if (!at || page.blocked) return false;
  if (!adPlaces(ads)[at.place]) return false;
  if (at.entry && ads.skipShort !== false) {
    // An entry page that didn't say how long it is counts as short.
    if (typeof page.words !== 'number' || page.words < AD_MIN_WORDS) return false;
  }
  return true;
}

export function adsLive(ads: AdsSetting): boolean {
  return ads.enabled && ADSENSE_CLIENT_RE.test(ads.client);
}

/** The settings, if ads should run on this page; otherwise null. Never throws (no ads on error). */
export async function adsFor(path: string, page: AdPageFacts = {}): Promise<AdsSetting | null> {
  if (!adPlace(path) || page.blocked) return null;
  try {
    const ads = await getSetting('ads');
    return adsLive(ads) && adsAllowedOn(path, ads, page) ? ads : null;
  } catch {
    return null;
  }
}

export function validSlot(slot: string): boolean {
  return ADSENSE_SLOT_RE.test(slot);
}
