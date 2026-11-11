// Telegram status for Settings: is the bot connected (its @username only; the token never leaves the server).
import type { APIRoute } from 'astro';
import { botStatus } from '../../../../lib/server/telegram';
import { json } from '../../../../lib/server/http';

export const GET: APIRoute = async () => json(await botStatus());
