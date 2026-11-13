// SERVER-ONLY. What the Ads tab's checklist reports: the things a Google AdSense reviewer looks for
// that this site can check by itself. Read-only; counts only what is live on the public site.
import { sql } from './db';
import { getPage, getSettings } from './repo';
import { wordCount } from './text';
import { ADSENSE_CLIENT_RE } from '../shared/safe';
import { imagesWithoutAlt } from '../shared/doc-checks';
import { AD_MIN_WORDS, type AdReadiness, type DocNode, type Page } from '../shared/types';

const written = (p: Page | null): boolean => !!p && Array.isArray(p.body?.content) && p.body.content.length > 0;

export async function adReadiness(): Promise<AdReadiness> {
  const [{ sections, ads }, privacy, about, contact, rows] = await Promise.all([
    getSettings(['sections', 'ads']),
    getPage('privacy'), getPage('about'), getPage('contact'),
    sql()`SELECT dek, body FROM entries
          WHERE status = 'published' AND is_public = true AND published_at <= now()
          ORDER BY published_at DESC LIMIT 1000`,
  ]);
  const entries = { total: rows.length, noSummary: 0, noAlt: 0, short: 0 };
  for (const r of rows) {
    const body = r.body as DocNode | undefined;
    if (!String(r.dek ?? '').trim()) entries.noSummary++;
    if (imagesWithoutAlt(body) > 0) entries.noAlt++;
    if (wordCount(body) < AD_MIN_WORDS) entries.short++;
  }
  return {
    privacy: !written(privacy) ? 'missing' : privacy?.noindex ? 'hidden' : 'ok',
    about: !written(about) ? 'missing' : sections.about ? 'ok' : 'off',
    contact: !written(contact) ? 'missing' : sections.contact ? 'ok' : 'off',
    adsTxt: ADSENSE_CLIENT_RE.test(ads.client),
    entries,
  };
}
