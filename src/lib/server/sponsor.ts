// SERVER-ONLY. One-time sponsor through Stripe Checkout and PayPal Checkout.
//
// Security:
//  - Visitors pay on Stripe's or PayPal's own page. This site never sees card or PayPal details and loads
//    no payment script; it only redirects to the address the provider returns (and checks its host first).
//  - The amount is checked here against the settings (amountProblem); the browser only says which amount.
//  - Keys are sealed with AUTH_SECRET (AES-GCM, bound to the provider) in sponsor_keys and only opened
//    here. They're never returned to the browser or logged; provider errors are reported from their
//    message text only.
//  - Stripe tells us about payments through a webhook the site creates when you connect, signed with its
//    own secret (verifyStripeSignature). PayPal payments are captured server-side when the visitor returns.
//  - Starting a payment is rate-limited per visitor (SPONSOR_LIMITER) and capped site-wide per hour, to
//    blunt card-testing. Unfinished attempts (and their messages) are deleted after 2 days.
import { env } from 'cloudflare:workers';
import { sql } from './db';
import { getPublicEntryById, getSetting, putSetting } from './repo';
import { authSecretProblem, openSecret, sealSecret } from './authcrypto';
import { verifyStripeSignature } from './stripe-sig';
import { amountProblem, cleanMessage, formatMoney, paypalMeUrl, SPONSOR_CURRENCY } from '../shared/sponsor';
import { KIND_BACK, KIND_PATH, paypalVia, sponsorLive, type SponsorSetting } from '../shared/types';

const STRIPE_API = 'https://api.stripe.com';
const PAYPAL_API = { live: 'https://api-m.paypal.com', test: 'https://api-m.sandbox.paypal.com' } as const;
const CHECKOUT_HOSTS = { stripe: ['https://checkout.stripe.com/'], paypal: ['https://www.paypal.com/', 'https://www.sandbox.paypal.com/'] } as const;
const TIMEOUT_MS = 12_000;
/** Payments started across the whole site per hour before new ones are refused for a while. */
const HOURLY_CAP = 60;
const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded'];

export type Provider = 'stripe' | 'paypal';
type Mode = 'live' | 'test';
export class SponsorError extends Error {}

function missingTable(e: unknown): boolean {
  return (e as { code?: string })?.code === '42P01';
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');

// ---------- calling the providers ----------

interface Reply<T> { ok: boolean; status: number; data: T & { error?: { message?: string; code?: string }; message?: string; name?: string; details?: { issue?: string }[] } }

async function call<T>(url: string, init: RequestInit): Promise<Reply<T>> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const data = (await res.json().catch(() => ({}))) as Reply<T>['data'];
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: (e as Error)?.name === 'TimeoutError' ? 'didn’t answer in time' : 'couldn’t be reached' } as Reply<T>['data'] };
  }
}

/** Stripe wants form encoding with brackets: a[b][0]=c. */
function form(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

function stripe<T>(key: string, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (params && method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return call<T>(`${STRIPE_API}${path}`, { method, headers, body: params && method === 'POST' ? form(params).toString() : undefined });
}
const stripeMessage = (r: Reply<unknown>) => clip(r.data?.error?.message ?? r.data?.message, 200) || `HTTP ${r.status}`;

interface PaypalCreds { clientId: string; secret: string; mode: Mode }
const tokenCache = new Map<string, { token: string; until: number }>();

async function paypalToken(c: PaypalCreds): Promise<{ token: string } | { error: string; status: number }> {
  const hit = tokenCache.get(`${c.mode}:${c.clientId}`);
  if (hit && hit.until > Date.now()) return { token: hit.token };
  const r = await call<{ access_token?: string; expires_in?: number; error_description?: string }>(`${PAYPAL_API[c.mode]}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${c.clientId}:${c.secret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok || !r.data.access_token) return { error: clip(r.data.error_description ?? r.data.message, 200) || `HTTP ${r.status}`, status: r.status };
  tokenCache.set(`${c.mode}:${c.clientId}`, { token: r.data.access_token, until: Date.now() + Math.max(60, (r.data.expires_in ?? 600) - 120) * 1000 });
  return { token: r.data.access_token };
}

async function paypal<T>(c: PaypalCreds, method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string): Promise<Reply<T>> {
  const t = await paypalToken(c);
  if ('error' in t) return { ok: false, status: t.status, data: { message: t.error } as Reply<T>['data'] };
  const headers: Record<string, string> = { authorization: `Bearer ${t.token}`, 'content-type': 'application/json', prefer: 'return=representation' };
  if (requestId) headers['paypal-request-id'] = requestId;
  return call<T>(`${PAYPAL_API[c.mode]}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const paypalMessage = (r: Reply<unknown>) => clip(r.data?.details?.[0]?.issue ?? r.data?.message ?? r.data?.name, 200) || `HTTP ${r.status}`;

// ---------- stored keys ----------

interface KeyRow { provider: Provider; secret_sealed: string; webhook_id: string | null; webhook_secret_sealed: string | null; mode: Mode; account_name: string; hint: string; connected_at: string }

async function keyRow(provider: Provider): Promise<KeyRow | null> {
  try {
    const rows = await sql()`SELECT * FROM sponsor_keys WHERE provider = ${provider}`;
    return (rows[0] as KeyRow) ?? null;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

async function open(sealed: string | null, provider: Provider | 'stripe-webhook'): Promise<string | null> {
  if (!sealed || authSecretProblem(env.AUTH_SECRET)) return null;
  const pt = await openSecret(env.AUTH_SECRET!, sealed, `sponsor-${provider}`);
  return pt ? new TextDecoder().decode(pt) : null;
}
const seal = (plain: string, provider: Provider | 'stripe-webhook') => sealSecret(env.AUTH_SECRET!, new TextEncoder().encode(plain), `sponsor-${provider}`);

async function stripeKey(): Promise<{ key: string; row: KeyRow } | null> {
  const row = await keyRow('stripe');
  const key = row ? await open(row.secret_sealed, 'stripe') : null;
  return row && key ? { key, row } : null;
}
async function paypalCreds(): Promise<{ creds: PaypalCreds; row: KeyRow } | null> {
  const row = await keyRow('paypal');
  const raw = row ? await open(row.secret_sealed, 'paypal') : null;
  if (!row || !raw) return null;
  try {
    const j = JSON.parse(raw) as { clientId: string; secret: string };
    return { creds: { clientId: j.clientId, secret: j.secret, mode: row.mode }, row };
  } catch {
    return null;
  }
}

/** Keeps the setting's record of which ways to pay are connected (the public pages read it). */
async function setMethod(provider: Provider, on: boolean): Promise<void> {
  const s = await getSetting('sponsor');
  await putSetting('sponsor', { ...s, methods: { ...s.methods, [provider]: on } });
}

export interface ProviderStatus { connected: boolean; mode: Mode | null; account: string; hint: string; connectedAt: string | null; lastPaidAt: string | null }
export interface SponsorStatus { available: boolean; stripe: ProviderStatus; paypal: ProviderStatus }
const OFF: ProviderStatus = { connected: false, mode: null, account: '', hint: '', connectedAt: null, lastPaidAt: null };

export async function sponsorStatus(): Promise<SponsorStatus> {
  let keys, last;
  try {
    keys = await sql()`SELECT provider, mode, account_name, hint, connected_at FROM sponsor_keys`;
    last = await sql()`SELECT provider, max(paid_at) AS at FROM sponsors WHERE status IN ('paid', 'refunded') GROUP BY provider`;
  } catch (e) {
    if (missingTable(e)) return { available: false, stripe: OFF, paypal: OFF };
    throw e;
  }
  const one = (p: Provider): ProviderStatus => {
    const k = keys.find((r) => r.provider === p);
    if (!k) return OFF;
    const at = last.find((r) => r.provider === p)?.at;
    return { connected: true, mode: k.mode as Mode, account: k.account_name as string, hint: k.hint as string, connectedAt: new Date(k.connected_at as string).toISOString(), lastPaidAt: at ? new Date(at as string).toISOString() : null };
  };
  return { available: true, stripe: one('stripe'), paypal: one('paypal') };
}

function requireSecret(): void {
  const problem = authSecretProblem(env.AUTH_SECRET);
  if (problem) throw new SponsorError(`Can’t store keys safely: ${problem}`);
}

// ---------- connecting ----------

/** Checks the key can create checkouts, creates the payment-notification webhook, stores both sealed. */
export async function connectStripe(key: string, siteUrl: string): Promise<void> {
  requireSecret();
  const mode: Mode = key.includes('_live_') ? 'live' : 'test';
  const probe = await stripe(key, 'GET', '/v1/checkout/sessions?limit=1');
  if (probe.status === 401) throw new SponsorError('Stripe didn’t accept that key. Copy it again from Developers → API keys.');
  if (probe.status === 403) throw new SponsorError('This key can’t create payments. Give it “Checkout Sessions: Write”.');
  if (!probe.ok) throw new SponsorError(`Stripe said: ${stripeMessage(probe)}`);

  const before = await stripeKey();
  const hook = await stripe<{ id: string; secret: string }>(key, 'POST', '/v1/webhook_endpoints', {
    url: `${siteUrl.replace(/\/$/, '')}/api/hooks/stripe`,
    enabled_events: STRIPE_EVENTS,
    description: 'sxingxian sponsor payments',
  });
  if (hook.status === 403) throw new SponsorError('This key can’t set up payment notifications. Give it “Webhook Endpoints: Write”.');
  if (!hook.ok || !hook.data.id || !hook.data.secret) throw new SponsorError(`Stripe said: ${stripeMessage(hook)}`);

  // The account's name, if this key may read it (a restricted key usually can't; that's fine).
  const acct = await stripe<{ settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string } }>(key, 'GET', '/v1/account');
  const account = acct.ok ? clip(acct.data.settings?.dashboard?.display_name || acct.data.business_profile?.name, 120) : '';

  await sql()`INSERT INTO sponsor_keys (provider, secret_sealed, webhook_id, webhook_secret_sealed, mode, account_name, hint, connected_at)
    VALUES ('stripe', ${await seal(key, 'stripe')}, ${hook.data.id}, ${await seal(hook.data.secret, 'stripe-webhook')}, ${mode}, ${account}, ${`…${key.slice(-4)}`}, now())
    ON CONFLICT (provider) DO UPDATE SET secret_sealed = EXCLUDED.secret_sealed, webhook_id = EXCLUDED.webhook_id,
      webhook_secret_sealed = EXCLUDED.webhook_secret_sealed, mode = EXCLUDED.mode, account_name = EXCLUDED.account_name, hint = EXCLUDED.hint, connected_at = now()`;
  // Replacing a key: remove the old webhook so Stripe doesn't keep calling with the old secret.
  if (before?.row.webhook_id && before.row.webhook_id !== hook.data.id) await stripe(before.key, 'DELETE', `/v1/webhook_endpoints/${encodeURIComponent(before.row.webhook_id)}`);
  await setMethod('stripe', true);
}

export async function connectPaypal(clientId: string, secret: string, mode: Mode): Promise<void> {
  requireSecret();
  tokenCache.delete(`${mode}:${clientId}`);
  const t = await paypalToken({ clientId, secret, mode });
  if ('error' in t) {
    throw new SponsorError(t.status === 401
      ? `PayPal didn’t accept those. Check they’re from a ${mode === 'live' ? 'Live' : 'Sandbox'} app.`
      : `PayPal said: ${t.error}`);
  }
  await sql()`INSERT INTO sponsor_keys (provider, secret_sealed, mode, hint, connected_at)
    VALUES ('paypal', ${await seal(JSON.stringify({ clientId, secret }), 'paypal')}, ${mode}, ${`…${clientId.slice(-4)}`}, now())
    ON CONFLICT (provider) DO UPDATE SET secret_sealed = EXCLUDED.secret_sealed, mode = EXCLUDED.mode, hint = EXCLUDED.hint, account_name = '', connected_at = now()`;
  await setMethod('paypal', true);
}

export async function disconnect(provider: Provider): Promise<void> {
  if (provider === 'stripe') {
    const s = await stripeKey().catch(() => null);
    if (s?.row.webhook_id) await stripe(s.key, 'DELETE', `/v1/webhook_endpoints/${encodeURIComponent(s.row.webhook_id)}`);
  }
  try {
    await sql()`DELETE FROM sponsor_keys WHERE provider = ${provider}`;
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  await setMethod(provider, false);
}

/** Asks the provider whether the stored keys still work. */
export async function checkProvider(provider: Provider): Promise<{ ok: boolean; message: string }> {
  if (provider === 'stripe') {
    const s = await stripeKey();
    if (!s) return { ok: false, message: 'Not connected' };
    const r = await stripe<{ status?: string }>(s.key, 'GET', `/v1/webhook_endpoints/${encodeURIComponent(s.row.webhook_id ?? '')}`);
    if (r.status === 401) return { ok: false, message: 'Stripe no longer accepts the key. Connect again with a new one.' };
    if (r.status === 404) return { ok: false, message: 'The payment notification was deleted in Stripe. Connect again to set it up.' };
    if (!r.ok) return { ok: false, message: `Stripe said: ${stripeMessage(r)}` };
    return r.data.status === 'disabled' ? { ok: false, message: 'Payment notifications are switched off in Stripe (Developers → Webhooks).' } : { ok: true, message: 'Stripe is working' };
  }
  const p = await paypalCreds();
  if (!p) return { ok: false, message: 'Not connected' };
  tokenCache.delete(`${p.creds.mode}:${p.creds.clientId}`);
  const t = await paypalToken(p.creds);
  return 'error' in t ? { ok: false, message: `PayPal said: ${t.error}` } : { ok: true, message: 'PayPal is working' };
}

// ---------- a visitor paying ----------

export interface CheckoutInput { method: Provider | 'paypalme'; amount: number; message: string; from?: string | null }


/** Records the attempt and asks Stripe or PayPal for a payment page. Returns where to send the visitor. */
export async function startCheckout(input: CheckoutInput, origin: string): Promise<string> {
  const s: SponsorSetting = await getSetting('sponsor');
  const available = input.method === 'stripe' ? s.methods.stripe : input.method === 'paypal' ? paypalVia(s) === 'api' : paypalVia(s) === 'me';
  if (!sponsorLive(s) || !available) throw new SponsorError('This way to pay isn’t available right now');
  const problem = amountProblem(s, input.amount);
  if (problem) throw new SponsorError(problem);

  const recent = await sql()`SELECT count(*)::int AS n FROM sponsors WHERE created_at > now() - interval '1 hour'`;
  if (Number(recent[0]?.n ?? 0) >= HOURLY_CAP) throw new SponsorError('A lot of payments are being started right now. Please try again in a few minutes.');

  const source = input.from && UUID_RE.test(input.from) ? await getPublicEntryById(input.from).catch(() => null) : null;
  const site = (await getSetting('site')).title || 'sxingxian';
  // PayPal.Me: nothing to set up with PayPal. Keep the amount and note for you to check against PayPal later.
  if (input.method === 'paypalme') {
    await sql()`INSERT INTO sponsors (provider, status, amount_cents, currency, message, source_id, source_title)
      VALUES ('paypalme', 'unconfirmed', ${input.amount}, ${SPONSOR_CURRENCY}, ${cleanMessage(input.message)}, ${source?.id ?? null}, ${clip(source?.title, 300)})`;
    return paypalMeUrl(s.paypalMe, input.amount);
  }
  const rows = await sql()`INSERT INTO sponsors (provider, amount_cents, currency, message, source_id, source_title)
    VALUES (${input.method}, ${input.amount}, ${SPONSOR_CURRENCY}, ${cleanMessage(input.message)}, ${source?.id ?? null}, ${clip(source?.title, 300)})
    RETURNING id`;
  const id = rows[0].id as string;
  const back = (page: 'thanks' | 'cancelled') => `${origin}/sponsor/${page}?via=${input.method}&ref=${id}`;

  try {
    if (input.method === 'stripe') {
      const k = await stripeKey();
      if (!k) throw new SponsorError('Card payments aren’t set up right now');
      const r = await stripe<{ id: string; url: string }>(k.key, 'POST', '/v1/checkout/sessions', {
        mode: 'payment',
        submit_type: 'donate',
        client_reference_id: id,
        metadata: { sponsor_id: id },
        line_items: [{ quantity: 1, price_data: { currency: SPONSOR_CURRENCY.toLowerCase(), unit_amount: input.amount, product_data: { name: `Sponsor ${site}`, description: source ? `From “${clip(source.title, 200)}”` : 'One-time sponsor' } } }],
        success_url: back('thanks'),
        cancel_url: back('cancelled'),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, `sponsor-${id}`);
      if (!r.ok || !r.data.id || !r.data.url) throw new SponsorError(`Card payments aren’t working right now (Stripe: ${stripeMessage(r)})`);
      if (!CHECKOUT_HOSTS.stripe.some((h) => r.data.url.startsWith(h))) throw new SponsorError('Stripe sent an unexpected payment address');
      await sql()`UPDATE sponsors SET ref = ${r.data.id}, live = ${k.row.mode === 'live'} WHERE id = ${id}`;
      return r.data.url;
    }
    const p = await paypalCreds();
    if (!p) throw new SponsorError('PayPal isn’t set up right now');
    const r = await paypal<{ id: string; links?: { rel: string; href: string }[] }>(p.creds, 'POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: id, custom_id: id, description: clip(`Sponsor ${site}${source ? ` – ${source.title}` : ''}`, 127), amount: { currency_code: SPONSOR_CURRENCY, value: (input.amount / 100).toFixed(2) } }],
      payment_source: { paypal: { experience_context: { brand_name: clip(site, 127), shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: back('thanks'), cancel_url: back('cancelled') } } },
    }, `sponsor-${id}`);
    const url = r.data.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? '';
    if (!r.ok || !r.data.id || !url) throw new SponsorError(`PayPal isn’t working right now (${paypalMessage(r)})`);
    if (!CHECKOUT_HOSTS.paypal.some((h) => url.startsWith(h))) throw new SponsorError('PayPal sent an unexpected payment address');
    await sql()`UPDATE sponsors SET ref = ${r.data.id}, live = ${p.row.mode === 'live'} WHERE id = ${id}`;
    return url;
  } catch (e) {
    await sql()`DELETE FROM sponsors WHERE id = ${id}`.catch(() => {});
    throw e instanceof SponsorError ? e : new SponsorError('Payments aren’t working right now. Please try again later.');
  }
}

interface SponsorRow { id: string; provider: Provider; ref: string; status: string; amount_cents: number; source_id: string | null; payment_ref: string }

async function rowFor(id: string, provider: Provider): Promise<SponsorRow | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    const rows = await sql()`SELECT id, provider, ref, status, amount_cents, source_id, payment_ref FROM sponsors WHERE id = ${id} AND provider = ${provider}`;
    return (rows[0] as SponsorRow) ?? null;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

async function markPaid(id: string, f: { name: string; email: string; amount: number | null; paymentRef: string; live?: boolean }): Promise<void> {
  await sql()`UPDATE sponsors SET status = 'paid', paid_at = coalesce(paid_at, now()), name = ${clip(f.name, 200)}, email = ${clip(f.email, 254)},
    amount_cents = coalesce(${f.amount}::int, amount_cents), payment_ref = ${clip(f.paymentRef, 255)}, live = coalesce(${f.live ?? null}::boolean, live)
    WHERE id = ${id} AND status IN ('pending', 'cancelled', 'failed')`;
}

interface StripeSession { id: string; status?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string | null; client_reference_id?: string | null; customer_details?: { name?: string | null; email?: string | null } | null; livemode?: boolean }

function paidFromSession(s: StripeSession) {
  return { name: s.customer_details?.name ?? '', email: s.customer_details?.email ?? '', amount: s.currency === SPONSOR_CURRENCY.toLowerCase() && Number.isInteger(s.amount_total) ? s.amount_total! : null, paymentRef: s.payment_intent ?? '', live: s.livemode };
}

/** Where to go "back" to: the page they came from (a story, work, photos or film), or the home page. */
async function backTo(sourceId: string | null): Promise<{ back: string; backLabel: string }> {
  const e = sourceId ? await getPublicEntryById(sourceId).catch(() => null) : null;
  return e ? { back: `${KIND_PATH[e.kind]}/${e.slug}`, backLabel: KIND_BACK[e.kind] } : { back: '/', backLabel: 'Back to the site' };
}

export interface ReturnView { state: 'paid' | 'processing' | 'declined' | 'unknown'; amount: string | null; back: string; backLabel: string; via: Provider }

/** The visitor came back from paying. Confirms with the provider (and takes a PayPal payment). */
export async function finishReturn(id: string, via: Provider): Promise<ReturnView> {
  const row = await rowFor(id, via);
  if (!row) return { state: 'unknown', amount: null, back: '/', backLabel: 'Back to the site', via };
  const view = (state: ReturnView['state']): ReturnView => ({ state, amount: formatMoney(row.amount_cents), back: '/', backLabel: 'Back to the site', via });
  let out: ReturnView;
  if (row.status === 'paid' || row.status === 'refunded') out = view('paid');
  else if (via === 'stripe') {
    const k = await stripeKey();
    const r = k && row.ref ? await stripe<StripeSession>(k.key, 'GET', `/v1/checkout/sessions/${encodeURIComponent(row.ref)}`) : null;
    if (r?.ok && r.data.client_reference_id === row.id && (r.data.payment_status === 'paid' || r.data.payment_status === 'no_payment_required')) {
      await markPaid(row.id, paidFromSession(r.data));
      out = view('paid');
    } else if (r?.ok && r.data.status === 'complete') out = view('processing'); // e.g. PayNow still confirming; the webhook finishes it
    else out = view(row.status === 'failed' ? 'declined' : 'processing');
  } else {
    const p = await paypalCreds();
    if (!p || !row.ref) out = view('unknown');
    else {
      type Order = { id: string; status?: string; payer?: { name?: { given_name?: string; surname?: string }; email_address?: string }; purchase_units?: { custom_id?: string; payments?: { captures?: { id: string; status: string; amount?: { value: string; currency_code: string } }[] } }[] };
      let r = await paypal<Order>(p.creds, 'POST', `/v2/checkout/orders/${encodeURIComponent(row.ref)}/capture`, {}, `capture-${row.id}`);
      if (!r.ok && r.data?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED') r = await paypal<Order>(p.creds, 'GET', `/v2/checkout/orders/${encodeURIComponent(row.ref)}`);
      const cap = r.data?.purchase_units?.[0]?.payments?.captures?.[0];
      const mine = r.ok && r.data.id === row.ref;
      if (mine && cap?.status === 'COMPLETED') {
        const amount = cap.amount?.currency_code === SPONSOR_CURRENCY ? Math.round(Number(cap.amount.value) * 100) : null;
        const n = r.data.payer?.name;
        await markPaid(row.id, { name: [n?.given_name, n?.surname].filter(Boolean).join(' '), email: r.data.payer?.email_address ?? '', amount: Number.isInteger(amount) ? amount : null, paymentRef: cap.id, live: p.row.mode === 'live' });
        out = view('paid');
      } else if (mine && cap?.status === 'PENDING') out = view('processing');
      else if (!r.ok && ['INSTRUMENT_DECLINED', 'PAYER_ACTION_REQUIRED', 'ORDER_NOT_APPROVED'].includes(r.data?.details?.[0]?.issue ?? '')) out = view('declined');
      else out = view('unknown');
    }
  }
  return { ...out, ...(await backTo(row.source_id)) };
}

/** The visitor backed out on Stripe or PayPal. Closes the attempt (unless it was in fact paid). */
export async function cancelReturn(id: string, via: Provider): Promise<{ paid: boolean; amount: number | null; back: string; backLabel: string; from: string | null }> {
  const row = await rowFor(id, via);
  if (!row) return { paid: false, amount: null, back: '/', backLabel: 'Back to the site', from: null };
  let paid = row.status === 'paid' || row.status === 'refunded';
  if (!paid && row.status === 'pending' && via === 'stripe') {
    const k = await stripeKey();
    const r = k && row.ref ? await stripe<StripeSession>(k.key, 'GET', `/v1/checkout/sessions/${encodeURIComponent(row.ref)}`) : null;
    if (r?.ok && r.data.client_reference_id === row.id && r.data.payment_status === 'paid') {
      await markPaid(row.id, paidFromSession(r.data));
      paid = true;
    } else if (k && r?.ok && r.data.status === 'open') {
      await stripe(k.key, 'POST', `/v1/checkout/sessions/${encodeURIComponent(row.ref)}/expire`); // the old payment page stops working
    }
  }
  if (!paid) await sql()`UPDATE sponsors SET status = 'cancelled' WHERE id = ${row.id} AND status = 'pending'`;
  return { paid, amount: row.amount_cents, ...(await backTo(row.source_id)), from: row.source_id };
}

// ---------- Stripe's webhook ----------

/** Verifies and applies one Stripe event. Returns an HTTP status for Stripe. */
export async function handleStripeWebhook(body: string, signature: string | null): Promise<number> {
  const row = await keyRow('stripe');
  const secret = row ? await open(row.webhook_secret_sealed, 'stripe-webhook') : null;
  if (!secret || !(await verifyStripeSignature(secret, signature, body))) return 401;
  let event: { type?: string; livemode?: boolean; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return 400;
  }
  const obj = event.data?.object ?? {};
  if (event.type?.startsWith('checkout.session.')) {
    const s = obj as unknown as StripeSession;
    const id = typeof s.client_reference_id === 'string' && UUID_RE.test(s.client_reference_id) ? s.client_reference_id : null;
    if (!id) return 200; // not one of ours
    const mine = await sql()`SELECT id FROM sponsors WHERE id = ${id} AND provider = 'stripe' AND ref = ${s.id}`;
    if (!mine.length) return 200;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') await markPaid(id, paidFromSession(s));
      else await sql()`UPDATE sponsors SET payment_ref = ${clip(s.payment_intent, 255)} WHERE id = ${id} AND status = 'pending'`;
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await sql()`UPDATE sponsors SET status = 'failed' WHERE id = ${id} AND status = 'pending'`;
    } else if (event.type === 'checkout.session.expired') {
      await sql()`UPDATE sponsors SET status = 'cancelled' WHERE id = ${id} AND status = 'pending'`;
    }
  } else if (event.type === 'charge.refunded' && obj.refunded === true && typeof obj.payment_intent === 'string') {
    await sql()`UPDATE sponsors SET status = 'refunded' WHERE provider = 'stripe' AND payment_ref = ${obj.payment_intent} AND status = 'paid'`;
  }
  return 200;
}

// ---------- the admin's list ----------

export type Via = Provider | 'paypalme';
export interface SponsorItem { id: string; at: string; amount: number; status: 'paid' | 'refunded'; name: string; email: string; message: string; source: string; via: Via; link: string | null; live: boolean }
export interface ToCheck { id: string; at: string; amount: number; message: string; source: string }
export interface SponsorList { available: boolean; month: { total: number; count: number }; all: { total: number; count: number }; top: { title: string; count: number } | null; toCheck: ToCheck[]; items: SponsorItem[]; total: number }

function paymentLink(via: Via, ref: string, live: boolean): string | null {
  if (via === 'paypalme' || !ref || !/^[A-Za-z0-9_-]{1,255}$/.test(ref)) return null;
  if (via === 'stripe') return `https://dashboard.stripe.com/${live ? '' : 'test/'}payments/${ref}`;
  return `https://www.${live ? '' : 'sandbox.'}paypal.com/activity/payment/${ref}`;
}

/** Totals, the PayPal.Me ones to check, and one page (`offset`, `size`) of paid or refunded sponsors, newest first. */
export async function listSponsors(size = 10, offset = 0): Promise<SponsorList> {
  try {
    const [totals, top, rows, check] = await Promise.all([
      sql()`SELECT
          coalesce(sum(amount_cents) FILTER (WHERE status = 'paid' AND paid_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')), 0)::int AS m_total,
          count(*) FILTER (WHERE status = 'paid' AND paid_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore'))::int AS m_count,
          coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS a_total,
          count(*) FILTER (WHERE status = 'paid')::int AS a_count,
          count(*)::int AS n_rows
        FROM sponsors WHERE status IN ('paid', 'refunded')`,
      sql()`SELECT source_title AS title, count(*)::int AS n FROM sponsors WHERE status = 'paid' AND source_id IS NOT NULL AND source_title <> ''
        GROUP BY source_id, source_title ORDER BY n DESC, max(paid_at) DESC LIMIT 1`,
      sql()`SELECT id, provider, status, amount_cents, name, email, message, source_title, payment_ref, live, paid_at FROM sponsors
        WHERE status IN ('paid', 'refunded') ORDER BY paid_at DESC NULLS LAST, id LIMIT ${size} OFFSET ${offset}`,
      sql()`SELECT id, amount_cents, message, source_title, created_at FROM sponsors WHERE status = 'unconfirmed' ORDER BY created_at DESC LIMIT 100`,
    ]);
    const t = totals[0] ?? {};
    return {
      available: true,
      month: { total: Number(t.m_total ?? 0), count: Number(t.m_count ?? 0) },
      all: { total: Number(t.a_total ?? 0), count: Number(t.a_count ?? 0) },
      top: top[0] ? { title: top[0].title as string, count: Number(top[0].n) } : null,
      toCheck: check.map((r) => ({ id: r.id as string, at: new Date(r.created_at as string).toISOString(), amount: Number(r.amount_cents), message: r.message as string, source: (r.source_title as string) || '/sponsor' })),
      items: rows.map((r) => ({
        id: r.id as string, at: new Date(r.paid_at as string).toISOString(), amount: Number(r.amount_cents), status: r.status as 'paid' | 'refunded',
        name: r.name as string, email: r.email as string, message: r.message as string, source: (r.source_title as string) || '/sponsor',
        via: r.provider as Via, link: paymentLink(r.provider as Via, r.payment_ref as string, !!r.live), live: !!r.live,
      })),
      total: Number(t.n_rows ?? 0),
    };
  } catch (e) {
    if (missingTable(e)) return { available: false, month: { total: 0, count: 0 }, all: { total: 0, count: 0 }, top: null, toCheck: [], items: [], total: 0 };
    throw e;
  }
}

/** After checking PayPal: a PayPal.Me sponsor arrived (with the amount that actually came) or didn't. */
export async function markSponsor(id: string, mark: { action: 'received'; amount: number } | { action: 'not-received' }): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = mark.action === 'received'
    ? await sql()`UPDATE sponsors SET status = 'paid', amount_cents = ${mark.amount}, paid_at = created_at WHERE id = ${id} AND status = 'unconfirmed' RETURNING id`
    : await sql()`DELETE FROM sponsors WHERE id = ${id} AND status = 'unconfirmed' RETURNING id`;
  return rows.length > 0;
}

/** Daily: unfinished attempts (and the notes typed into them) don't need keeping; nor PayPal.Me ones left unmarked for 30 days. */
export async function tidySponsors(): Promise<void> {
  try {
    await sql()`DELETE FROM sponsors WHERE status IN ('pending', 'cancelled', 'failed') AND created_at < now() - interval '2 days'`;
    await sql()`DELETE FROM sponsors WHERE status = 'unconfirmed' AND created_at < now() - interval '30 days'`;
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}
