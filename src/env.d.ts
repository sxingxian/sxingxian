/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare/types.d.ts" />

/**
 * Worker bindings, vars and secrets. Everything here is SERVER-ONLY and is read
 * through `import { env } from 'cloudflare:workers'` inside src/lib/server/**.
 * Nothing in this interface may be imported by client (React admin) code.
 */
interface SxEnv {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  WEBHOOK_LIMITER?: RateLimit;
  LOGIN_LIMITER?: RateLimit;
  VIEW_LIMITER?: RateLimit;
  SPONSOR_LIMITER?: RateLimit;

  // vars (non-secret)
  SITE_URL: string;
  WP_BASE_URL: string;
  NAS_S3_ENDPOINT?: string;
  NAS_S3_BUCKET?: string;
  NAS_S3_REGION?: string;
  B2_S3_ENDPOINT?: string;
  B2_S3_BUCKET?: string;
  B2_S3_REGION?: string;

  // secrets (wrangler secret put)
  DATABASE_URL: string;
  AUTH_SECRET?: string;   // encrypts 2FA secrets at rest (32+ chars)
  SETUP_TOKEN?: string;   // one-time token for /admin/setup while no account exists
  WP_WEBHOOK_SECRET: string;
  NAS_S3_ACCESS_KEY_ID?: string;
  NAS_S3_SECRET_ACCESS_KEY?: string;
  NAS_ACCESS_CLIENT_ID?: string;
  NAS_ACCESS_CLIENT_SECRET?: string;
  B2_S3_ACCESS_KEY_ID?: string;
  B2_S3_SECRET_ACCESS_KEY?: string;
}

declare namespace Cloudflare {
  interface Env extends SxEnv {}
}
interface Env extends SxEnv {}

declare namespace App {
  interface Locals {
    cspNonce?: string;
    user?: import('./lib/server/users').SessionUser;
    sessionHash?: string;
    /** Set by the page being rendered, read by the layout and ad slots: see src/lib/server/ads.ts. */
    adFacts?: import('./lib/server/ads').AdPageFacts;
  }
}
