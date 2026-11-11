// Asks Stripe or PayPal whether the stored keys still work (POST {provider}).
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { checkProvider } from '../../../../lib/server/sponsor';
import { json, readBody } from '../../../../lib/server/http';

export const POST: APIRoute = async ({ request }) => {
  const b = await readBody(request, z.object({ provider: z.enum(['stripe', 'paypal']) }), 200);
  if (!b.ok) return b.res;
  return json(await checkProvider(b.data.provider));
};
