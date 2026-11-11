// One entry's Telegram section in the publishing panel.
//   GET: options, the channels that take this kind, what was posted where, and the post as it would go out.
//   PUT {announce, message, image}: save the options.
//   POST {retry: chat}: try a failed channel again now (live entries only).
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { adminGetEntry, getMedia, getSetting } from '../../../../../lib/server/repo';
import { announceEntry, botStatus, channelsFor, getEntryTelegram, postFor, postsFor, putEntryTelegram } from '../../../../../lib/server/telegram';
import { error, json, readBody } from '../../../../../lib/server/http';
import { entryTelegramSchema, TELEGRAM_CHAT_RE } from '../../../../../lib/shared/schemas';
import { UUID_RE } from '../../../../../lib/shared/safe';
import { entryState } from '../../../../../lib/shared/state';

async function view(id: string, origin: string) {
  const entry = await adminGetEntry(id);
  if (!entry) return null;
  const status = await botStatus();
  const options = await getEntryTelegram(id);
  const channels = (await channelsFor(entry.kind)).map((c) => ({ chat: c.chat, title: c.title }));
  const { post, defaultMessage } = await postFor(entry, options, origin);
  const { attachImage } = await getSetting('telegram');
  return { ...status, options, channels, posts: await postsFor(id), preview: { html: post.html, imageId: post.imageId, button: post.button.text }, defaultMessage, coverId: attachImage ? entry.cover_media_id : null };
}

export const GET: APIRoute = async ({ params, site, url }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const v = await view(params.id!, (site ?? url).origin);
  return v ? json(v) : error(404, 'Not found');
};

export const PUT: APIRoute = async ({ params, request, site, url }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const b = await readBody(request, entryTelegramSchema, 20_000);
  if (!b.ok) return b.res;
  if (!(await adminGetEntry(params.id!))) return error(404, 'Not found');
  if (b.data.image !== 'cover' && b.data.image !== 'none') {
    const m = await getMedia(b.data.image);
    if (!m || !m.mime.startsWith('image/')) return error(422, 'Pick a photo from the library');
  }
  const message = b.data.message === null || b.data.message.trim() === '' ? null : b.data.message;
  await putEntryTelegram(params.id!, { ...b.data, message });
  return json(await view(params.id!, (site ?? url).origin));
};

const retryBody = z.object({ retry: z.string().regex(TELEGRAM_CHAT_RE) });

export const POST: APIRoute = async ({ params, request, site, url }) => {
  if (!UUID_RE.test(params.id ?? '')) return error(404, 'Not found');
  const b = await readBody(request, retryBody, 1000);
  if (!b.ok) return b.res;
  const entry = await adminGetEntry(params.id!);
  if (!entry) return error(404, 'Not found');
  if (entryState(entry) !== 'published') return error(409, 'It posts when it goes live');
  await announceEntry(entry.id, { only: b.data.retry, force: true });
  return json(await view(entry.id, (site ?? url).origin));
};
