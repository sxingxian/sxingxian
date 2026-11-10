// Public endpoint called by the WordPress plugin on hey.sxingxian.com.
// Verifies an HMAC signature, then fetches the post from WordPress itself.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { syncOne, verifyWebhook, log } from '../../../lib/server/wordpress';
import { error, json } from '../../../lib/server/http';

const WEBHOOK_DELAY_MS = 5000;

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  if (env.WEBHOOK_LIMITER) {
    const { success } = await env.WEBHOOK_LIMITER.limit({ key: clientAddress || 'unknown' });
    if (!success) return error(429, 'Too many requests');
  }
  const body = await request.text();
  if (body.length > 2048) return error(413, 'Body too large');

  const valid = await verifyWebhook(request.headers.get('X-Sx-Timestamp'), request.headers.get('X-Sx-Signature'), body);
  if (!valid) {
    locals.cfContext?.waitUntil(log('Webhook rejected', 'bad or expired signature', false).catch(() => {}));
    return error(401, 'Invalid signature');
  }

  let payload: { post_id?: unknown; action?: unknown };
  try {
    payload = JSON.parse(body);
  } catch {
    return error(400, 'Invalid JSON');
  }
  const postId = Number(payload.post_id);
  if (!Number.isInteger(postId) || postId <= 0) return error(422, 'post_id must be a positive integer');
  const action = typeof payload.action === 'string' ? payload.action.slice(0, 20) : 'update';

  // Respond fast; do the fetch-back in the background. Wait a few seconds first: WordPress's editor
  // saves the post, then its featured image and categories, and older plugin versions notify at the
  // first step, so fetching straight away could read the old image.
  const job = new Promise((r) => setTimeout(r, WEBHOOK_DELAY_MS))
    .then(() => syncOne(postId, `Webhook (${action})`))
    .catch(() => 'failed');
  if (locals.cfContext) locals.cfContext.waitUntil(job);
  else await job;
  return json({ ok: true }, { status: 202 });
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');
