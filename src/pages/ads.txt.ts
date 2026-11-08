// /ads.txt for Google AdSense. Served as soon as a valid publisher ID is saved (even before ads
// are switched on), because Google checks it while reviewing the site.
import type { APIRoute } from 'astro';
import { getSetting } from '../lib/server/repo';
import { ADSENSE_CLIENT_RE } from '../lib/shared/safe';

export const GET: APIRoute = async () => {
  const { client } = await getSetting('ads');
  if (!ADSENSE_CLIENT_RE.test(client)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(`google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
};
