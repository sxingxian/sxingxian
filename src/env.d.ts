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

  // vars (non-secret)
  SITE_URL: string;
  WP_BASE_URL: string;
  ACCESS_TEAM_DOMAIN?: string;
  ADMIN_EMAILS?: string;
  NAS_S3_ENDPOINT?: string;
  NAS_S3_BUCKET?: string;
  NAS_S3_REGION?: string;
  B2_S3_ENDPOINT?: string;
  B2_S3_BUCKET?: string;
  B2_S3_REGION?: string;

  // secrets (wrangler secret put)
  DATABASE_URL: string;
  ACCESS_AUD: string;
  WP_WEBHOOK_SECRET: string;
  NAS_S3_ACCESS_KEY_ID?: string;
  NAS_S3_SECRET_ACCESS_KEY?: string;
  B2_S3_ACCESS_KEY_ID?: string;
  B2_S3_SECRET_ACCESS_KEY?: string;

  // local development only
  DEV_AUTH_BYPASS?: string;
}

declare namespace Cloudflare {
  interface Env extends SxEnv {}
}
interface Env extends SxEnv {}

declare namespace App {
  interface Locals {
    cspNonce?: string;
    adminEmail?: string;
  }
}
