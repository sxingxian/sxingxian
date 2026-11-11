// Connect (POST {token}) or disconnect (DELETE) the bot. The token is checked with Telegram, sealed and stored;
// the reply only carries the bot's @username.
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { connectBot, disconnectBot, TelegramError } from '../../../../lib/server/telegram';
import { error, json, readBody } from '../../../../lib/server/http';

const body = z.object({ token: z.string().trim().min(1).max(120) });

export const POST: APIRoute = async ({ request }) => {
  const b = await readBody(request, body, 1000);
  if (!b.ok) return b.res;
  try {
    return json({ username: await connectBot(b.data.token) });
  } catch (e) {
    if (e instanceof TelegramError) return error(400, e.message);
    throw e;
  }
};

export const DELETE: APIRoute = async () => {
  await disconnectBot();
  return json({ ok: true });
};
