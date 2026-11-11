// SERVER-ONLY. Checks the Stripe-Signature header on a webhook (no Stripe library needed):
// "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}` with the endpoint's signing secret>[,v1=…]".
// Rejects anything older than 5 minutes (or from the future), so a captured request can't be replayed later.
import { safeEqual, toHex } from './authcrypto';

export const STRIPE_TOLERANCE_S = 300;

export async function verifyStripeSignature(secret: string, header: string | null, body: string, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !header || header.length > 1024) return false;
  let t = 0;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim() ?? '');
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(nowS - t) > STRIPE_TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  return sigs.some((s) => safeEqual(s, mac));
}
