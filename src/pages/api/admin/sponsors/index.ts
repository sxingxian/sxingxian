// The sponsors received: totals and the paid (or refunded) payments, newest first (?page=0,1,…).
import type { APIRoute } from 'astro';
import { listSponsors } from '../../../../lib/server/sponsor';
import { json } from '../../../../lib/server/http';

export const GET: APIRoute = async ({ url }) => {
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get('page') ?? '0', 10) || 0, 0), 1000);
  return json(await listSponsors(page));
};
