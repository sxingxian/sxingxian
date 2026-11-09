// RSS 2.0 feed: native stories + visible WordPress posts.
import type { APIRoute } from 'astro';
import { getFeed } from '../lib/server/site';
import { getSettings } from '../lib/server/repo';
import { escXml } from '../lib/server/text';

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const settings = await getSettings(['site', 'footer', 'wordpress']);
  const items = (await getFeed({ limit: 40 })).filter((i) => i.source === 'native' || settings.wordpress.includeInRss);

  const xmlItems = items
    .map((i) => {
      const link = i.external ? i.url : `${origin}${i.url}`;
      return `    <item>
      <title>${escXml(i.title)}</title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="true">${escXml(link)}</guid>
      <pubDate>${new Date(i.date).toUTCString()}</pubDate>
      ${i.topic ? `<category>${escXml(i.topic)}</category>` : ''}
      <description>${escXml(i.dek)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(settings.site.title)} — ${escXml(settings.site.tagline)}</title>
    <link>${origin}/</link>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${escXml(settings.footer.about)}</description>
    <language>en-sg</language>
${xmlItems}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
};
