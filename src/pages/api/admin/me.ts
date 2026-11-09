import type { APIRoute } from 'astro';
import { json } from '../../../lib/server/http';
import { availableProviders } from '../../../lib/server/storage';
import { wpBase } from '../../../lib/server/wordpress';

// Non-secret facts the admin UI needs. Never include secrets or credentials here.
export const GET: APIRoute = async ({ locals }) => {
  const u = locals.user!;
  let wp = '';
  try { wp = await wpBase(); } catch { wp = ''; }
  return json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword, totpEnabled: u.totpEnabled },
    email: u.email,
    providers: availableProviders(),
    wpBaseUrl: wp,
    wpAdminUrl: wp ? `${wp}/admin` : '',
  });
};
