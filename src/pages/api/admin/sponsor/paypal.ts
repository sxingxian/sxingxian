// Connect PayPal (POST {clientId, secret, mode}: checked with PayPal, then sealed) or disconnect it (DELETE).
import type { APIRoute } from 'astro';
import { connectPaypal, disconnect, sponsorStatus, SponsorError } from '../../../../lib/server/sponsor';
import { error, json, readBody } from '../../../../lib/server/http';
import { paypalConnectSchema } from '../../../../lib/shared/schemas';

export const POST: APIRoute = async ({ request }) => {
  const b = await readBody(request, paypalConnectSchema, 2000);
  if (!b.ok) return b.res;
  try {
    await connectPaypal(b.data.clientId, b.data.secret, b.data.mode);
    return json(await sponsorStatus());
  } catch (e) {
    if (e instanceof SponsorError) return error(400, e.message);
    throw e;
  }
};

export const DELETE: APIRoute = async () => {
  await disconnect('paypal');
  return json(await sponsorStatus());
};
