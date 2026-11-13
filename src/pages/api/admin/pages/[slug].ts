import type { APIRoute } from 'astro';
import { getPage, putPage } from '../../../../lib/server/repo';
import { error, json, readBody } from '../../../../lib/server/http';
import { pageInputSchema } from '../../../../lib/shared/schemas';
import { PAGE_SLUGS, type PageSlug } from '../../../../lib/shared/types';

const SLUGS = new Set<string>(PAGE_SLUGS);
type Slug = PageSlug;
const TITLES: Record<Slug, string> = { cv: 'CV', about: 'About', privacy: 'Privacy', contact: 'Contact' };

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? '';
  if (!SLUGS.has(slug)) return error(404, 'Not found');
  const page = await getPage(slug as Slug);
  return json({ page: page ?? { slug, title: TITLES[slug as Slug], body: { type: 'doc', content: [] }, noindex: false, updated_at: null } });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const slug = params.slug ?? '';
  if (!SLUGS.has(slug)) return error(404, 'Not found');
  const body = await readBody(request, pageInputSchema);
  if (!body.ok) return body.res;
  return json({ page: await putPage(slug as Slug, body.data) });
};
