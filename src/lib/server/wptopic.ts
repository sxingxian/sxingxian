// SERVER-ONLY: which story topic and featured image a WordPress post gets.
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

interface WpMedia {
  source_url?: string;
  media_details?: { sizes?: Record<string, { source_url?: string } | undefined> };
}

/**
 * The featured-image address to show for a WordPress post: a mid-size rendition when WordPress made one
 * (medium_large → large → original). http:// links are upgraded to https:// (the page would block them
 * otherwise); anything that isn't a plain https URL is dropped.
 */
export function pickImage(media: WpMedia | null | undefined): string {
  const sizes = media?.media_details?.sizes;
  const raw = sizes?.medium_large?.source_url || sizes?.large?.source_url || media?.source_url || '';
  return safeImageUrl(raw);
}

export function safeImageUrl(raw: string): string {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return '';
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    return u.toString();
  } catch {
    return '';
  }
}
