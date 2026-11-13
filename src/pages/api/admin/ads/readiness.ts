// The Ads tab's checklist. Admin only (the middleware guards /api/admin); read-only.
import type { APIRoute } from 'astro';
import { adReadiness } from '../../../../lib/server/readiness';
import { json } from '../../../../lib/server/http';

export const GET: APIRoute = async () => json(await adReadiness());
