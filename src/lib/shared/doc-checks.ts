// Checks on a document that both the server (Ads checklist) and the editor (before publishing) use.
import type { DocNode } from './types';

/** Photos in a document that have no description (alt text). Cover photos are not counted. */
export function imagesWithoutAlt(node: DocNode | undefined, depth = 0): number {
  if (!node || depth > 50) return 0;
  let n = 0;
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  if (node.type === 'figure' && !(typeof attrs.alt === 'string' && attrs.alt.trim())) n++;
  if (node.type === 'gallery' && Array.isArray(attrs.items)) {
    for (const it of attrs.items.slice(0, 100)) {
      const alt = (it as { alt?: unknown } | null)?.alt;
      if (!(typeof alt === 'string' && alt.trim())) n++;
    }
  }
  for (const c of node.content ?? []) n += imagesWithoutAlt(c, depth + 1);
  return n;
}
