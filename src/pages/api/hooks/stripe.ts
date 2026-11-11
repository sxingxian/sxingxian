// Public endpoint called by Stripe about sponsor payments (paid, PayNow confirmed or failed, expired, refunded).
// Every request must carry a valid Stripe-Signature made with the secret of the webhook the site created.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleStripeWebhook } from '../../../lib/server/sponsor';
import { error, json } from '../../../lib/server/http';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (env.WEBHOOK_LIMITER) {
    const { success } = await env.WEBHOOK_LIMITER.limit({ key: `stripe:${clientAddress || 'unknown'}` });
    if (!success) return error(429, 'Too many requests');
  }
  if (Number(request.headers.get('content-length') ?? '0') > 65_536) return error(413, 'Body too large');
  const body = await request.text();
  if (body.length > 65_536) return error(413, 'Body too large');
  const status = await handleStripeWebhook(body, request.headers.get('Stripe-Signature'));
  return status === 200 ? json({ received: true }) : error(status, status === 401 ? 'Invalid signature' : 'Bad request');
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
