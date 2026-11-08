// SERVER-ONLY. Where Google AdSense may run.
import { getSetting } from './repo';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE } from '../shared/safe';
import type { AdsSetting } from '../shared/types';

// Never: the admin, the API, and the pages that stand for you professionally.
const NO_ADS = ['/admin', '/api', '/cv', '/about', '/privacy', '/media', '/rss.xml', '/ads.txt'];

export function adsAllowedOn(path: string): boolean {
  return !NO_ADS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function adsLive(ads: AdsSetting): boolean {
  return ads.enabled && ADSENSE_CLIENT_RE.test(ads.client);
}

/** The settings, if ads should run on this path; otherwise null. Never throws (no ads on error). */
export async function adsFor(path: string): Promise<AdsSetting | null> {
  if (!adsAllowedOn(path)) return null;
  try {
    const ads = await getSetting('ads');
    return adsLive(ads) ? ads : null;
  } catch {
    return null;
  }
}

export function validSlot(slot: string): boolean {
  return ADSENSE_SLOT_RE.test(slot);
}
