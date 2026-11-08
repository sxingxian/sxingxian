// POST /api/admin/resolve-link { url } → { url } (admin only).
// TikTok share links (vm.tiktok.com/…) redirect to the real video URL, which holds the id.
// Only TikTok hosts are followed (max 4 hops, https only), so this can't be used to reach
// other sites or internal addresses.
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { error, json, readBody } from '../../../lib/server/http';
import { isTikTokShortLink, parseVideoUrl } from '../../../lib/shared/safe';

const schema = z.object({ url: z.string().max(500) });
const isTikTokHost = (h: string) => h === 'tiktok.com' || h.endsWith('.tiktok.com');

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, schema, 2048);
  if (!body.ok) return body.res;
  if (!isTikTokShortLink(body.data.url)) return error(422, 'Not a TikTok share link');
  let current = new URL(body.data.url.trim());
  for (let hop = 0; hop < 4; hop++) {
    if (current.protocol !== 'https:' || !isTikTokHost(current.hostname)) return error(422, 'That link doesn’t lead to a TikTok video');
    let res: Response;
    try {
      res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sxingxian-admin/1.0)' }, signal: AbortSignal.timeout(6000) });
    } catch {
      return error(502, 'Couldn’t open that link. Paste the full tiktok.com/@…/video/… address instead.');
    }
    const loc = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current);
      if (parseVideoUrl(current.href)?.provider === 'tiktok') return json({ url: `https://www.tiktok.com${current.pathname}` });
      continue;
    }
    break;
  }
  return error(422, 'Couldn’t find the video in that link. Paste the full tiktok.com/@…/video/… address instead.');
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
