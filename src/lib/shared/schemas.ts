// Zod schemas: every write to the API is validated with these on the server.
// The admin uses the same schemas for instant feedback, but the server is the
// authority — client-side checks are a convenience, not a control.
import { z } from 'zod';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE, isSafeHref, SLUG_RE, UUID_RE } from './safe';

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
  protection: z.object({
    watermark: z.boolean(),
    text: z.string().trim().min(1, 'Add watermark text').max(60),
    position: z.enum(['br', 'bl', 'center', 'tiled']),
    size: z.enum(['s', 'm', 'l']),
    opacity: z.number().min(0.1).max(0.7),
    blockSave: z.boolean(),
  }),
  ads: z.object({
    enabled: z.boolean(),
    client: z.string().trim().refine((v) => v === '' || ADSENSE_CLIENT_RE.test(v), 'Publisher ID looks like ca-pub-1234567890123456'),
    homeSlot: z.string().trim().refine((v) => v === '' || ADSENSE_SLOT_RE.test(v), 'Ad slot IDs are numbers only'),
    articleSlot: z.string().trim().refine((v) => v === '' || ADSENSE_SLOT_RE.test(v), 'Ad slot IDs are numbers only'),
  }).refine((v) => !v.enabled || v.client !== '', { message: 'Add your publisher ID before turning ads on', path: ['client'] }),
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

// ------------------------------------------------------------- accounts

const emailField = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));
const passwordField = z.string().min(1, 'Enter a password').max(256);

export const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().max(256),
  code: z.string().trim().max(20).optional(),
});

export const setupSchema = z.object({
  token: z.string().max(256),
  name: z.string().trim().max(80).default(''),
  email: emailField,
  password: passwordField,
});

export const passwordChangeSchema = z.object({
  current: z.string().max(256),
  next: passwordField,
});

export const passwordConfirmSchema = z.object({ password: z.string().max(256) });
export const totpCodeSchema = z.object({ code: z.string().trim().max(20) });
export const totpDisableSchema = z.object({ password: z.string().max(256), code: z.string().trim().max(20) });
export const profileSchema = z.object({ name: z.string().trim().max(80) });

export const userCreateSchema = z.object({
  email: emailField,
  name: z.string().trim().max(80).default(''),
  role: z.enum(['owner', 'admin']).default('admin'),
});

export const userPatchSchema = z.object({
  role: z.enum(['owner', 'admin']).optional(),
  disabled: z.boolean().optional(),
  resetPassword: z.literal(true).optional(),
  reset2fa: z.literal(true).optional(),
  unlock: z.literal(true).optional(),
});
