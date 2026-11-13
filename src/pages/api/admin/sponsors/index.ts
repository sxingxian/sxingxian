// The sponsors received: totals and the paid (or refunded) payments, newest first (?page=1,2,… &size=10|25|50|100).
import type { APIRoute } from 'astro';
import { listSponsors } from '../../../../lib/server/sponsor';
import { json } from '../../../../lib/server/http';
import { readPaging } from '../../../../lib/shared/paging';

export const GET: APIRoute = async ({ url }) => {
  const { page, size, offset } = readPaging(url.searchParams);
  return json({ ...(await listSponsors(size, offset)), page, size });
};
