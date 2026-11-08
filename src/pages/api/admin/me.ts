import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json } from '../../../lib/server/http';
import { availableProviders } from '../../../lib/server/storage';

// Non-secret facts the admin UI needs. Never include secrets or credentials here.
export const GET: APIRoute = ({ locals }) =>
  json({
    email: locals.adminEmail ?? '',
    providers: availableProviders(),
    wpBaseUrl: env.WP_BASE_URL,
    wpAdminUrl: `${env.WP_BASE_URL.replace(/\/+$/, '')}/admin`,
  });
