// Mark a PayPal.Me sponsor after checking PayPal (POST {action: 'received', amount} or {action: 'not-received'}).
import type { APIRoute } from 'astro';
import { markSponsor } from '../../../../lib/server/sponsor';
import { error, json, readBody } from '../../../../lib/server/http';
import { sponsorMarkSchema } from '../../../../lib/shared/schemas';

export const POST: APIRoute = async ({ params, request }) => {
  const b = await readBody(request, sponsorMarkSchema, 500);
  if (!b.ok) return b.res;
  if (!(await markSponsor(params.id ?? '', b.data))) return error(404, 'That one was already marked, or is gone');
  return json({ ok: true });
};
