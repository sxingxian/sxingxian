// Which ways to pay are connected (never the keys themselves).
import type { APIRoute } from 'astro';
import { sponsorStatus } from '../../../../lib/server/sponsor';
import { json } from '../../../../lib/server/http';

export const GET: APIRoute = async () => json(await sponsorStatus());
