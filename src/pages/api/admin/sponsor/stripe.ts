// Connect Stripe (POST {key}: a restricted key, checked with Stripe, then sealed; the site creates its own
// payment-notification webhook) or disconnect it (DELETE, which also removes that webhook).
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { connectStripe, disconnect, sponsorStatus, SponsorError } from '../../../../lib/server/sponsor';
import { error, json, readBody } from '../../../../lib/server/http';
import { stripeConnectSchema } from '../../../../lib/shared/schemas';

export const POST: APIRoute = async ({ request, url }) => {
  const b = await readBody(request, stripeConnectSchema, 2000);
  if (!b.ok) return b.res;
  try {
    await connectStripe(b.data.key, env.SITE_URL || url.origin);
    return json(await sponsorStatus());
  } catch (e) {
    if (e instanceof SponsorError) return error(400, e.message);
    throw e;
  }
};

export const DELETE: APIRoute = async () => {
  await disconnect('stripe');
  return json(await sponsorStatus());
};
