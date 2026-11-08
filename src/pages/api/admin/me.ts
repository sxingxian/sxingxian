import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json } from '../../../lib/server/http';
import { availableProviders } from '../../../lib/server/storage';

// Non-secret facts the admin UI needs. Never include secrets or credentials here.
export const GET: APIRoute = ({ locals }) => {
  const u = locals.user!;
  return json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword, totpEnabled: u.totpEnabled },
    email: u.email,
    providers: availableProviders(),
    wpBaseUrl: env.WP_BASE_URL,
    wpAdminUrl: `${env.WP_BASE_URL.replace(/\/+$/, '')}/admin`,
  });
};
