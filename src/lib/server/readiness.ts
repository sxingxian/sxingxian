// SERVER-ONLY. What the Ads tab's checklist reports: the things a Google AdSense reviewer looks for
// that this site can check by itself. Read-only; counts only what is live on the public site.
import { sql } from './db';
import { getPage, getSettings } from './repo';
import { wordCount } from './text';
import { ADSENSE_CLIENT_RE } from '../shared/safe';
import { imagesWithoutAlt } from '../shared/doc-checks';
import { AD_MIN_WORDS, READINESS_LIST_MAX, type AdReadiness, type DocNode, type EntryKind, type Page, type ReadinessEntry } from '../shared/types';

const written = (p: Page | null): boolean => !!p && Array.isArray(p.body?.content) && p.body.content.length > 0;

export async function adReadiness(): Promise<AdReadiness> {
  const [{ sections, ads }, privacy, about, contact, rows] = await Promise.all([
    getSettings(['sections', 'ads']),
    getPage('privacy'), getPage('about'), getPage('contact'),
    // entry_edits: saved edits to a live entry that aren't live yet (they may already fix what is listed).
    sql()`SELECT e.id, e.kind, e.title, e.dek, e.body, e.published_at, (x.entry_id IS NOT NULL) AS pending
          FROM entries e LEFT JOIN entry_edits x ON x.entry_id = e.id
          WHERE e.status = 'published' AND e.is_public = true AND e.published_at <= now()
          ORDER BY e.published_at DESC LIMIT 1000`,
  ]);
  const entries = { total: rows.length, noSummary: 0, noAlt: 0, short: 0 };
  const lists: AdReadiness['lists'] = { noSummary: [], noAlt: [] };
  // Only what the list needs: never the body or the summary text.
  const item = (r: Record<string, unknown>, missing?: number): ReadinessEntry => ({
    id: String(r.id),
    kind: r.kind as EntryKind,
    title: String(r.title ?? ''),
    published_at: new Date(r.published_at as string).toISOString(),
    pending: r.pending === true,
    ...(missing ? { missing } : {}),
  });
  for (const r of rows) {
    const body = r.body as DocNode | undefined;
    const noAlt = imagesWithoutAlt(body);
    if (!String(r.dek ?? '').trim()) {
      entries.noSummary++;
      if (lists.noSummary.length < READINESS_LIST_MAX) lists.noSummary.push(item(r));
    }
    if (noAlt > 0) {
      entries.noAlt++;
      if (lists.noAlt.length < READINESS_LIST_MAX) lists.noAlt.push(item(r, noAlt));
    }
    if (wordCount(body) < AD_MIN_WORDS) entries.short++;
  }
  return {
    privacy: !written(privacy) ? 'missing' : privacy?.noindex ? 'hidden' : 'ok',
    about: !written(about) ? 'missing' : sections.about ? 'ok' : 'off',
    contact: !written(contact) ? 'missing' : sections.contact ? 'ok' : 'off',
    adsTxt: ADSENSE_CLIENT_RE.test(ads.client),
    entries,
    lists,
  };
}
