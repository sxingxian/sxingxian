// Public endpoint: a visitor going to pay. Validates the amount against the settings, records the attempt
// and returns the Stripe or PayPal page to send them to. Only this site's own pages may call it, a few times
// a minute per visitor (SPONSOR_LIMITER), with a small JSON body.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { startCheckout, SponsorError } from '../../../lib/server/sponsor';
import { error, json, readBody } from '../../../lib/server/http';
import { sponsorCheckoutSchema } from '../../../lib/shared/schemas';

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  if (request.headers.get('Origin') !== url.origin) return error(403, 'Cross-site request blocked');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return error(403, 'Cross-site request blocked');
  if (env.SPONSOR_LIMITER) {
    const { success } = await env.SPONSOR_LIMITER.limit({ key: `sponsor:${clientAddress || 'unknown'}` });
    if (!success) return error(429, 'Too many tries. Please wait a minute and try again.');
  }
  const b = await readBody(request, sponsorCheckoutSchema, 2000);
  if (!b.ok) return b.res;
  try {
    return json({ url: await startCheckout(b.data, url.origin) });
  } catch (e) {
    if (e instanceof SponsorError) return error(400, e.message);
    return error(503, 'Payments aren’t working right now. Please try again later.');
  }
};

export const GET: APIRoute = () => new Response(null, { status: 405, headers: { Allow: 'POST' } });
