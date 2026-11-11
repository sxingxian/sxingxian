// POST {chat, action: 'check' | 'test'}: check the bot can post to a channel, or send it a test message.
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { checkChannel, sendTest, TelegramError } from '../../../../lib/server/telegram';
import { error, json, readBody } from '../../../../lib/server/http';
import { TELEGRAM_CHAT_RE } from '../../../../lib/shared/schemas';

const body = z.object({ chat: z.string().trim().regex(TELEGRAM_CHAT_RE, 'A channel is @name, or a private channel’s -100… id'), action: z.enum(['check', 'test']) });

export const POST: APIRoute = async ({ request }) => {
  const b = await readBody(request, body, 1000);
  if (!b.ok) return b.res;
  try {
    if (b.data.action === 'test') {
      await sendTest(b.data.chat);
      return json({ ok: true });
    }
    return json(await checkChannel(b.data.chat));
  } catch (e) {
    if (e instanceof TelegramError) return error(400, e.message);
    throw e;
  }
};
