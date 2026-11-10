// SERVER-ONLY. Media storage backends. Credentials come from Worker secrets and
// are used only here to sign requests; they are never returned to any client.
import { AwsClient } from 'aws4fetch';
import { env } from 'cloudflare:workers';

export type StorageProvider = 'r2' | 'nas' | 'b2';

interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function s3Config(provider: 'nas' | 'b2'): S3Config | null {
  const c =
    provider === 'nas'
      ? {
          endpoint: env.NAS_S3_ENDPOINT,
          bucket: env.NAS_S3_BUCKET,
          region: env.NAS_S3_REGION || 'auto',
          accessKeyId: env.NAS_S3_ACCESS_KEY_ID,
          secretAccessKey: env.NAS_S3_SECRET_ACCESS_KEY,
        }
      : {
          endpoint: env.B2_S3_ENDPOINT,
          bucket: env.B2_S3_BUCKET,
          region: env.B2_S3_REGION || 'us-west-004',
          accessKeyId: env.B2_S3_ACCESS_KEY_ID,
          secretAccessKey: env.B2_S3_SECRET_ACCESS_KEY,
        };
  if (!c.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) return null;
  if (!c.endpoint.startsWith('https://')) return null; // never send credentials over plain HTTP
  return c as S3Config;
}

/** Which hosts are configured (shown in the upload dialog; no secrets included). */
export function availableProviders(): Record<StorageProvider, boolean> {
  return { r2: !!env.MEDIA, nas: !!s3Config('nas'), b2: !!s3Config('b2') };
}

function objectUrl(c: S3Config, key: string): string {
  const base = c.endpoint.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(c.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Optional Cloudflare Access service token for the NAS (when its S3 address sits behind Cloudflare Access).
 * Sent alongside the S3 signature, so even a leaked key can't be used from anywhere but this site.
 */
function accessHeaders(provider: 'nas' | 'b2'): Record<string, string> {
  if (provider !== 'nas' || !env.NAS_ACCESS_CLIENT_ID || !env.NAS_ACCESS_CLIENT_SECRET) return {};
  return { 'CF-Access-Client-Id': env.NAS_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.NAS_ACCESS_CLIENT_SECRET };
}

function client(c: S3Config): AwsClient {
  return new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: 's3', region: c.region });
}

/** A storage failure with a message that's safe and useful to show in the admin (no secrets). */
export class StorageError extends Error {}

const LABEL: Record<'nas' | 'b2', string> = { nas: 'Home NAS', b2: 'Backblaze B2' };

/** Read an S3 error response: the XML <Code> if there is one, and whether Cloudflare (not the server) answered. */
async function s3Error(res: Response): Promise<{ code: string; fromCloudflare: boolean }> {
  const text = (await res.text().catch(() => '')).slice(0, 4000);
  const code = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/.exec(text)?.[1] ?? '';
  const fromCloudflare = !code && (/cloudflare/i.test(text) || res.headers.has('cf-mitigated') || /text\/html/i.test(res.headers.get('content-type') ?? ''));
  return { code, fromCloudflare };
}

function explain(provider: 'nas' | 'b2', status: number, code: string, fromCloudflare: boolean): string {
  const who = LABEL[provider];
  if (fromCloudflare && (status === 401 || status === 403)) {
    return `${who}: Cloudflare Access blocked the request. Check NAS_ACCESS_CLIENT_ID / NAS_ACCESS_CLIENT_SECRET match the service token.`;
  }
  if (fromCloudflare || status === 502 || status === 503 || status === 530) {
    return `${who} isn't reachable (${status}). Check the NAS is on and the Cloudflare Tunnel shows Healthy, with its hostname pointing at the gateway.`;
  }
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || code === 'AuthorizationHeaderMalformed' || code === 'AccessDenied' || status === 403) {
    return `${who} refused the keys (${code || status}). Check the access key, secret key and region (NAS: us-east-1) match the gateway's settings.`;
  }
  return `${who} upload failed (${code || status}).`;
}

/**
 * Upload. On the NAS, a missing bucket is created once and the upload retried, so there is no separate
 * "create the bucket" step when setting the NAS up.
 */
export async function putObject(provider: StorageProvider, key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  if (provider === 'r2') {
    await env.MEDIA.put(key, body, { httpMetadata: { contentType } });
    return;
  }
  const c = s3Config(provider);
  if (!c) throw new StorageError(`${LABEL[provider]} storage is not set up (missing Worker secrets).`);
  const put = () =>
    client(c).fetch(objectUrl(c, key), {
      method: 'PUT',
      body,
      headers: { 'content-type': contentType, ...accessHeaders(provider) },
    });
  let res: Response;
  try {
    res = await put();
  } catch {
    throw new StorageError(`${LABEL[provider]} isn't reachable. Check the NAS is on and the Cloudflare Tunnel shows Healthy.`);
  }
  if (res.ok) return;
  let err = await s3Error(res);
  if (provider === 'nas' && err.code === 'NoSuchBucket') {
    const made = await client(c).fetch(`${c.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(c.bucket)}`, {
      method: 'PUT',
      headers: accessHeaders(provider),
    });
    const madeErr = made.ok ? null : await s3Error(made);
    if (!made.ok && madeErr?.code !== 'BucketAlreadyOwnedByYou' && madeErr?.code !== 'BucketAlreadyExists') {
      throw new StorageError(`Couldn't create the NAS bucket "${c.bucket}" (${madeErr?.code || made.status}).`);
    }
    res = await put();
    if (res.ok) return;
    err = await s3Error(res);
  }
  throw new StorageError(explain(provider, res.status, err.code, err.fromCloudflare));
}

export async function getObject(provider: StorageProvider, key: string, request: Request): Promise<Response | null> {
  if (provider === 'r2') {
    const obj = await env.MEDIA.get(key, { onlyIf: request.headers });
    if (!obj) return null;
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers });
  }
  const c = s3Config(provider);
  if (!c) return null;
  const res = await client(c).fetch(objectUrl(c, key), { method: 'GET', headers: accessHeaders(provider) });
  if (!res.ok || !res.body) return null;
  return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' } });
}

export async function deleteObject(provider: StorageProvider, key: string): Promise<void> {
  if (provider === 'r2') {
    await env.MEDIA.delete(key);
    return;
  }
  const c = s3Config(provider);
  if (!c) return;
  await client(c).fetch(objectUrl(c, key), { method: 'DELETE', headers: accessHeaders(provider) });
}
