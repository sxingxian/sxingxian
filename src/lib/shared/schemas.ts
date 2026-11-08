// Zod schemas: every write to the API is validated with these on the server.
// The admin uses the same schemas for instant feedback, but the server is the
// authority — client-side checks are a convenience, not a control.
import { z } from 'zod';
import { isSafeHref, SLUG_RE, UUID_RE } from './safe';

const MAX_DOC_BYTES = 1_000_000;

// The document tree itself is validated structurally by the renderer's
// allow-list; here we bound its size and shape.
export const docSchema = z
  .looseObject({ type: z.literal('doc'), content: z.array(z.any()).max(5000).optional() })
  .refine((d) => JSON.stringify(d).length <= MAX_DOC_BYTES, 'Document is too large (1 MB max)');

export const entryInputSchema = z.object({
  kind: z.enum(['post', 'project', 'gallery', 'film']),
  title: z.string().trim().min(1).max(200),
  slug: z.string().max(80, { abort: true }).regex(SLUG_RE, 'Use lowercase letters, numbers and dashes'),
  dek: z.string().max(400).default(''),
  topic: z.string().max(40).default(''),
  body: docSchema,
  cover_media_id: z.string().regex(UUID_RE).nullable().default(null),
  video_url: z
    .string()
    .max(300)
    .default('')
    .refine((v) => v === '' || isSafeHref(v), 'Must be an https link'),
  meta: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).default({}),
  status: z.enum(['draft', 'published']),
  is_public: z.boolean(),
  published_at: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type EntryInput = z.infer<typeof entryInputSchema>;

export const pageInputSchema = z.object({
  title: z.string().max(200).default(''),
  body: docSchema,
  noindex: z.boolean().default(false),
});

const safeUrl = z.string().max(2048).refine(isSafeHref, 'Use https://…, a page on this site (/cv) or mailto:');

export const settingsSchemas = {
  site: z.object({
    title: z.string().trim().min(1).max(60),
    tagline: z.string().max(60),
    topics: z.array(z.string().trim().min(1).max(30)).max(12),
  }),
  sections: z.object({
    work: z.boolean(),
    photos: z.boolean(),
    film: z.boolean(),
    cv: z.boolean(),
    about: z.boolean(),
  }),
  featured: z
    .object({ mode: z.enum(['latest', 'manual']), entryId: z.string().regex(UUID_RE).nullable() })
    .refine((v) => v.mode === 'latest' || v.entryId !== null, 'Pick a post to feature'),
  footer: z.object({
    about: z.string().max(160),
    columns: z
      .array(
        z.object({
          heading: z.string().max(30),
          links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: safeUrl })).max(8),
        }),
      )
      .max(3),
    bottomLine: z.string().max(140),
    showRss: z.boolean(),
    showBuiltOn: z.boolean(),
  }),
  wordpress: z.object({
    autoShow: z.boolean(),
    includeInRss: z.boolean(),
    hideWhenDown: z.boolean(),
    categoryMap: z.record(z.string().max(80), z.string().max(30)),
  }),
} as const;

export const mediaMetaSchema = z.object({
  provider: z.enum(['r2', 'nas', 'b2']),
  alt: z.string().max(300).default(''),
  width: z.coerce.number().int().positive().max(20000).optional(),
  height: z.coerce.number().int().positive().max(20000).optional(),
});

export const embedInputSchema = z.object({ url: z.string().max(300), alt: z.string().max(300).default('') });
