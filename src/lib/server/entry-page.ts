// SERVER-ONLY. The entry a public detail page shows: only when its section is on and the entry is public.
// Called from the page itself (not a component), so a missing entry can still set the 404 status
// before the response starts streaming.
import { getPublicEntry, getSetting } from './repo';
import { isSlug } from '../shared/safe';
import type { Entry, EntryKind, SectionsSetting } from '../shared/types';

export async function loadPublicEntry(kind: EntryKind, section: keyof SectionsSetting | null, slug: string | undefined): Promise<Entry | null> {
  if (!slug || !isSlug(slug)) return null;
  const enabled = section ? (await getSetting('sections'))[section] : true;
  return enabled ? getPublicEntry(kind, slug) : null;
}
