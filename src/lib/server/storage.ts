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

function client(c: S3Config): AwsClient {
  return new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: 's3', region: c.region });
}

export async function putObject(provider: StorageProvider, key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  if (provider === 'r2') {
    await env.MEDIA.put(key, body, { httpMetadata: { contentType } });
    return;
  }
  const c = s3Config(provider);
  if (!c) throw new Error(`${provider} storage is not configured`);
  const res = await client(c).fetch(objectUrl(c, key), {
    method: 'PUT',
    body,
    headers: { 'content-type': contentType },
  });
  if (!res.ok) throw new Error(`${provider} upload failed (${res.status})`);
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
  const res = await client(c).fetch(objectUrl(c, key), { method: 'GET' });
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
  await client(c).fetch(objectUrl(c, key), { method: 'DELETE' });
}
