// sitemap.xml for search engines and AI search: every public page, with its last change and cover image.
import type { APIRoute } from 'astro';
import { siteIndex } from '../lib/server/site-index';
import { escXml } from '../lib/server/text';

export const GET: APIRoute = async ({ site, url }) => {
  const origin = (site ?? url).origin;
  const urls = await siteIndex();
  const body = urls.map((u) => `  <url>
    <loc>${escXml(origin + u.path)}</loc>${u.lastmod ? `
    <lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}${u.image ? `
    <image:image><image:loc>${escXml(`${origin}/media/${u.image}`)}</image:loc></image:image>` : ''}
  </url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
};
