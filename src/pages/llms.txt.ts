// llms.txt (https://llmstxt.org): a plain summary of the site and its pages for AI assistants and AI search.
import type { APIRoute } from 'astro';
import { getSettings } from '../lib/server/repo';
import { siteIndex, type IndexedUrl } from '../lib/server/site-index';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const [{ site: s, footer }, urls] = await Promise.all([getSettings(['site', 'footer']), siteIndex()]);
  const groups: IndexedUrl['group'][] = ['Pages', 'Stories', 'Series', 'Work', 'Photos', 'Film'];
  const out = [`# ${oneLine(s.title)}`, '', `> ${oneLine([s.tagline, footer.about].filter(Boolean).join('. '))}`, ''];
  for (const g of groups) {
    const items = urls.filter((u) => u.group === g).slice(0, g === 'Pages' ? 20 : 200);
    if (!items.length) continue;
    out.push(`## ${g}`, '');
    for (const u of items) out.push(`- [${oneLine(u.title).replace(/[[\]]/g, '')}](${origin}${u.path})${u.description ? `: ${oneLine(u.description)}` : ''}`);
    out.push('');
  }
  out.push(`RSS: ${origin}/rss.xml`, `Sitemap: ${origin}/sitemap.xml`, '');
  return new Response(out.join('\n'), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
