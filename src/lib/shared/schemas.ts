// Zod schemas: every write to the API is validated with these on the server.
// The admin uses the same schemas for instant feedback, but the server is the
// authority — client-side checks are a convenience, not a control.
import { z } from 'zod';
import { DEFAULT_AD_PLACES, MAX_ENTRY_TOPICS, MAX_FEATURED, MAX_LIST_TOPICS, MAX_SERIES_PART, MAX_TOPIC_LEN } from './types';
import { ADSENSE_CLIENT_RE, ADSENSE_SLOT_RE, isSafeHref, SLUG_RE, stripInvisible, UUID_RE } from './safe';

/** A title with invisible characters removed (they arrive with pasted text and break search and sorting). */
const cleanTitle = (min: number, max: number, message?: string) =>
  z.string().max(max * 2).transform((v) => stripInvisible(v).trim()).pipe(z.string().min(min, message).max(max));

const MAX_DOC_BYTES = 1_000_000;

// The document tree itself is validated structurally by the renderer's
// allow-list; here we bound its size and shape.
export const docSchema = z
  .looseObject({ type: z.literal('doc'), content: z.array(z.any()).max(5000).optional() })
  .refine((d) => JSON.stringify(d).length <= MAX_DOC_BYTES, 'Document is too large (1 MB max)');

export const entryInputSchema = z.object({
  kind: z.enum(['post', 'project', 'gallery', 'film']),
  title: cleanTitle(1, 200),
  slug: z.string().max(80, { abort: true }).regex(SLUG_RE, 'Use lowercase letters, numbers and dashes'),
  dek: z.string().max(400).default(''),
  /** Ignored when topics is sent; the server derives it from topics[0]. Accepted for older clients. */
  topic: z.string().max(40).default(''),
  topics: z.array(z.string().trim().min(1).max(MAX_TOPIC_LEN)).max(MAX_ENTRY_TOPICS).optional(),
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

/** What the editor saves: content only. Draft / Scheduled / Published changes go through entryStateSchema. */
export const entryContentSchema = entryInputSchema.omit({ status: true, is_public: true, published_at: true });
export type EntryContent = z.infer<typeof entryContentSchema>;

/** One publishing action. `at` is the go-live time for schedule, the shown date for redate. */
export const entryStateSchema = z.object({
  action: z.enum(['publish', 'schedule', 'unpublish', 'update', 'discard', 'redate']),
  at: z.iso.datetime({ offset: true }).optional(),
});

export const pageInputSchema = z.object({
  title: cleanTitle(0, 200).default(''),
  body: docSchema,
  noindex: z.boolean().default(false),
});

const topicList = z.array(z.string().trim().min(1).max(MAX_TOPIC_LEN)).max(MAX_LIST_TOPICS);

const safeUrl = z.string().max(2048).refine(isSafeHref, 'Use https://…, a page on this site (/cv) or mailto:');

/** A Telegram chat the bot can post to: a public "@name" or a private channel's "-100…" id. */
export const TELEGRAM_CHAT_RE = /^(@[A-Za-z][A-Za-z0-9_]{3,31}|-100\d{6,14})$/;
/** BotFather token: "<bot id>:<secret>". */
export const TELEGRAM_TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{30,60}$/;
const ENTRY_KINDS = ['post', 'project', 'gallery', 'film'] as const;
const telegramButton = z.string().trim().min(1, 'Add the button text').max(40);

/** One entry's Telegram options. message null = use the default message. image: cover, none, or a library photo. */
export const entryTelegramSchema = z.object({
  announce: z.boolean(),
  message: z.string().max(4000).nullable(),
  image: z.union([z.enum(['cover', 'none']), z.uuid()]),
  /** null = follow the default in Settings → Telegram. */
  silent: z.boolean().nullable().default(null),
});
export type EntryTelegramInput = z.infer<typeof entryTelegramSchema>;

// ---------- sponsor ----------
/** Cents, S$1 to S$10,000. */
const sponsorCents = z.number().int().min(100).max(1_000_000);
const sponsorWords = (max: number) => z.string().trim().min(1).max(max);
export const STRIPE_KEY_RE = /^(rk|sk)_(live|test)_[A-Za-z0-9]{20,240}$/;
export const PAYPAL_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;

export const PAYPAL_ME_RE = /^[A-Za-z0-9]{0,20}$/;
export const sponsorSettingSchema = z.object({
  enabled: z.boolean(),
  storyCard: z.boolean(),
  cardKinds: z.array(z.enum(ENTRY_KINDS)).max(4).optional().default(['post', 'project', 'gallery', 'film']),
  paypalMode: z.enum(['me', 'api']).optional().default('me'),
  paypalMe: z.string().trim().regex(PAYPAL_ME_RE, 'A PayPal.Me name is letters and numbers, up to 20').optional().default(''),
  footerLink: z.boolean(),
  amounts: z.array(sponsorCents).min(1).max(4),
  defaultAmount: sponsorCents,
  allowCustom: z.boolean(),
  min: sponsorCents,
  max: sponsorCents,
  cardTitle: sponsorWords(80),
  cardText: sponsorWords(300),
  pageTitle: sponsorWords(80),
  pageText: sponsorWords(600),
  methods: z.object({ stripe: z.boolean(), paypal: z.boolean() }).optional(),
}).refine((s) => new Set(s.amounts).size === s.amounts.length, { message: 'Each amount once', path: ['amounts'] })
  .refine((s) => s.amounts.includes(s.defaultAmount), { message: 'The default must be one of the amounts', path: ['defaultAmount'] })
  .refine((s) => s.min < s.max, { message: 'The minimum must be below the maximum', path: ['max'] });

/** A visitor going to pay: which way, how much (cents), an optional note, and the story they came from. */
export const sponsorCheckoutSchema = z.object({
  method: z.enum(['stripe', 'paypal', 'paypalme']),
  amount: z.number().int().min(100).max(1_000_000),
  message: z.string().max(600).optional().default(''),
  from: z.uuid().nullable().optional(),
});

/** Marking a PayPal.Me sponsor after checking PayPal: received (with the amount that arrived) or not. */
export const sponsorMarkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('received'), amount: z.number().int().min(100).max(1_000_000) }),
  z.object({ action: z.literal('not-received') }),
]);

export const stripeConnectSchema = z.object({ key: z.string().trim().regex(STRIPE_KEY_RE, 'That doesn’t look like a Stripe key. It starts with rk_live_ or rk_test_') });
export const paypalConnectSchema = z.object({
  clientId: z.string().trim().regex(PAYPAL_ID_RE, 'That doesn’t look like a PayPal Client ID'),
  secret: z.string().trim().regex(PAYPAL_ID_RE, 'That doesn’t look like a PayPal Secret'),
  mode: z.enum(['live', 'test']),
});

export const settingsSchemas = {
  sponsor: sponsorSettingSchema,
  telegram: z.object({
    channels: z.array(z.object({
      chat: z.string().trim().regex(TELEGRAM_CHAT_RE, 'A channel is @name or a -100… id'),
      title: z.string().trim().max(128),
      kinds: z.array(z.enum(ENTRY_KINDS)).max(4),
      addedAt: z.iso.datetime({ offset: true }).optional(),
    })).max(10),
    template: z.string().max(2000),
    attachImage: z.boolean(),
    silent: z.boolean().default(false),
    buttons: z.object({ post: telegramButton, project: telegramButton, gallery: telegramButton, film: telegramButton }),
  }),
  protection: z.object({
    watermark: z.boolean(),
    text: z.string().trim().max(60),
    position: z.enum(['br', 'bl', 'center', 'tiled']),
    size: z.enum(['s', 'm', 'l']),
    opacity: z.number().min(0.1).max(0.7),
    blockSave: z.boolean(),
    logo: z.boolean().default(true),
    logoTint: z.enum(['original', 'white']).default('original'),
    // logoHash is not accepted from the client: the logo endpoint sets it.
  }),
  ads: z.object({
    enabled: z.boolean(),
    client: z.string().trim().refine((v) => v === '' || ADSENSE_CLIENT_RE.test(v), 'Publisher ID looks like ca-pub-1234567890123456'),
    homeSlot: z.string().trim().refine((v) => v === '' || ADSENSE_SLOT_RE.test(v), 'Ad slot IDs are numbers only'),
    articleSlot: z.string().trim().refine((v) => v === '' || ADSENSE_SLOT_RE.test(v), 'Ad slot IDs are numbers only'),
    // Switches only: unknown places are dropped, missing ones take the defaults.
    places: z.object({
      story: z.boolean().default(DEFAULT_AD_PLACES.story),
      home: z.boolean().default(DEFAULT_AD_PLACES.home),
      lists: z.boolean().default(DEFAULT_AD_PLACES.lists),
      photos: z.boolean().default(DEFAULT_AD_PLACES.photos),
      film: z.boolean().default(DEFAULT_AD_PLACES.film),
      work: z.boolean().default(DEFAULT_AD_PLACES.work),
    }).default({ ...DEFAULT_AD_PLACES }),
    skipShort: z.boolean().default(true),
  }).refine((v) => !v.enabled || v.client !== '', { message: 'Add your publisher ID before turning ads on', path: ['client'] }),
  site: z.object({
    title: z.string().trim().min(1).max(60),
    tagline: z.string().max(60),
    topics: topicList,
    defaultCoverId: z.string().regex(UUID_RE).nullable().optional(),
  }),
  topics: z.object({ work: topicList, photos: topicList, film: topicList }),
  sections: z.object({
    work: z.boolean(),
    photos: z.boolean(),
    film: z.boolean(),
    cv: z.boolean(),
    about: z.boolean(),
    contact: z.boolean().default(false),
  }),
  featured: z.object({
    entryIds: z.array(z.string().regex(UUID_RE)).max(MAX_FEATURED, `Up to ${MAX_FEATURED} featured stories`).transform((ids) => [...new Set(ids)]),
    order: z.enum(['date', 'custom']).default('date'),
  }),
  footer: z.object({
    about: z.string().max(160),
    columns: z
      .array(
        z.object({
          heading: z.string().max(30),
          links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: safeUrl, newTab: z.boolean().optional() })).max(8),
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

// ------------------------------------------------------------- series

export const seriesInputSchema = z.object({
  title: cleanTitle(1, 120, 'Add a title'),
  slug: z.string().max(80, { abort: true }).regex(SLUG_RE, 'Use lowercase letters, numbers and dashes'),
  description: z.string().trim().max(300).default(''),
  planned_parts: z.number().int().min(1).max(MAX_SERIES_PART).nullable().default(null),
  is_public: z.boolean().default(true),
});
export type SeriesInput = z.infer<typeof seriesInputSchema>;

/** Put a story in a series (or take it out with seriesId null). */
export const entrySeriesSchema = z.object({
  seriesId: z.string().regex(UUID_RE).nullable(),
  part: z.number().int().min(1).max(MAX_SERIES_PART).nullable().default(null),
});

/** A read counted by the public site: n:<story id> or w:<WordPress post id>. */
export const viewInputSchema = z.object({
  item: z.string().max(40).regex(/^(n:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|w:[1-9][0-9]{0,11})$/),
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
