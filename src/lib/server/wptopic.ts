// SERVER-ONLY: which story topic a WordPress post gets from its categories.
//
// Rules (one topic per WordPress post):
//   1. The first of the post's categories that has a mapping in Admin → WordPress → Category → topic.
//   2. Otherwise its first category other than "Uncategorized", as is.
//   3. Otherwise "Notes".
// Category names are compared after decoding HTML entities (WordPress sends "Tech &amp; Life"),
// trimming, collapsing spaces and ignoring case, so "tech", "Tech " and "TECH" all match "Tech".
import { MAX_TOPIC_LEN } from '../shared/types';
import { htmlToText } from './text';

export const FALLBACK_TOPIC = 'Notes';

export function categoryKey(name: string): string {
  return htmlToText(name).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function topicFor(categoryNames: readonly string[], categoryMap: Record<string, string>): string {
  const map = new Map<string, string>();
  for (const [cat, topic] of Object.entries(categoryMap ?? {})) {
    const k = categoryKey(cat);
    const t = String(topic ?? '').trim();
    if (k && t && !map.has(k)) map.set(k, t);
  }
  const names = categoryNames.map((n) => htmlToText(n)).filter(Boolean);
  for (const n of names) {
    const hit = map.get(categoryKey(n));
    if (hit) return hit.slice(0, MAX_TOPIC_LEN);
  }
  const first = names.find((n) => categoryKey(n) !== 'uncategorized');
  return (first || FALLBACK_TOPIC).slice(0, MAX_TOPIC_LEN);
}
