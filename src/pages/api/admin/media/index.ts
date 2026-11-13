// Upload media to the host chosen in the admin (R2, NAS, B2) or register a
// YouTube/Vimeo embed. Files are checked by declared type AND magic bytes.
import type { APIRoute } from 'astro';
import { insertMedia, listMedia, pageMedia, type MediaKindFilter } from '../../../../lib/server/repo';
import { readPaging } from '../../../../lib/shared/paging';
import { putObject, availableProviders, StorageError } from '../../../../lib/server/storage';
import { error, json } from '../../../../lib/server/http';
import { embedInputSchema, mediaMetaSchema } from '../../../../lib/shared/schemas';
import { parseVideoUrl } from '../../../../lib/shared/safe';
import { sniffDocument } from '../../../../lib/server/filetypes';
import { DOC_MIMES, MAX_DOC_BYTES, cleanFileName } from '../../../../lib/shared/files';

const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_VIDEO = 95 * 1024 * 1024; // Workers request bodies are capped at 100 MB

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
};

/** Identify the real file type from its first bytes. SVG/HTML are never accepted. */
function sniff(b: Uint8Array): string | null {
  const s = (o: number, sig: number[]) => sig.every((v, i) => b[o + i] === v);
  if (s(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (s(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (s(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (s(0, [0x52, 0x49, 0x46, 0x46]) && s(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  if (s(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (/^(isom|iso2|mp41|mp42|avc1|dash|M4V )/.test(brand)) return 'video/mp4';
  }
  if (s(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  return null;
}

const MEDIA_KINDS = new Set<MediaKindFilter>(['all', 'image', 'video', 'file']);

// No ?page → the newest 200 (the picker). ?page=&size=&kind= → one page of the library.
export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  if (!p.has('page')) return json({ media: await listMedia(), providers: availableProviders() });
  const kind = (p.get('kind') ?? 'all') as MediaKindFilter;
  if (!MEDIA_KINDS.has(kind)) return error(400, 'Unknown kind');
  const { page, size, offset } = readPaging(p);
  return json({ ...(await pageMedia({ kind, docMimes: [...DOC_MIMES], size, offset })), page, size });
};

export const POST: APIRoute = async ({ request }) => {
  const type = request.headers.get('content-type') ?? '';

  // --- embed (YouTube / Vimeo link) ---
  if (type.includes('application/json')) {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return error(400, 'Invalid JSON');
    }
    const parsed = embedInputSchema.safeParse(raw);
    if (!parsed.success) return error(422, 'Validation failed');
    const video = parseVideoUrl(parsed.data.url);
    if (!video || video.provider === 'tiktok') return error(422, 'Paste a YouTube or Vimeo link');
    const media = await insertMedia({
      provider: video.provider as 'youtube' | 'vimeo', object_key: '', embed_id: video.id, mime: 'text/x-embed', bytes: 0,
      width: null, height: null, alt: parsed.data.alt, filename: parsed.data.url.slice(0, 200),
    });
    return json({ media }, { status: 201 });
  }

  // --- file upload ---
  if (!type.includes('multipart/form-data')) return error(415, 'Expected multipart/form-data');
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > MAX_VIDEO + 1024 * 1024) return error(413, 'File too large');

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return error(422, 'Missing file');
  const meta = mediaMetaSchema.safeParse({
    provider: form.get('provider'), alt: form.get('alt') ?? '', width: form.get('width') || undefined, height: form.get('height') || undefined,
  });
  if (!meta.success) return error(422, 'Invalid upload details');
  const { provider, alt, width, height } = meta.data;

  if (!availableProviders()[provider]) return error(400, `${provider.toUpperCase()} storage is not configured`);

  const buf = await file.arrayBuffer();
  const sniffed = sniff(new Uint8Array(buf.slice(0, 16)));
  if (!sniffed || !EXT[sniffed]) {
    // Not a photo or video: maybe an allowed document (decided by its contents, never the declared type).
    if (buf.byteLength > MAX_DOC_BYTES) return error(413, 'Files must be under 25 MB');
    const doc = sniffDocument(new Uint8Array(buf), file.name);
    if (!doc.ok) return error(415, `${doc.reason}. Allowed: photos, video, PDF, Office and OpenDocument files, RTF, text, Markdown, CSV and calendar files.`);
    const now = new Date();
    const key = `files/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${doc.ext}`;
    const stored = await store(provider, key, buf, doc.mime);
    if (stored) return stored;
    const media = await insertMedia({
      provider, object_key: key, embed_id: '', mime: doc.mime, bytes: buf.byteLength,
      width: null, height: null, alt, filename: cleanFileName(file.name, doc.ext),
    });
    return json({ media }, { status: 201 });
  }
  const real = sniffed;
  const isVideo = real.startsWith('video/');
  if (buf.byteLength > (isVideo ? MAX_VIDEO : MAX_IMAGE)) return error(413, isVideo ? 'Videos must be under 95 MB' : 'Images must be under 25 MB');
  // Cloudflare's CDN terms only allow serving video hosted on Cloudflare (R2/Stream).
  if (isVideo && provider !== 'r2') return error(400, 'Videos can only be stored on R2 (or embed from YouTube/Vimeo)');

  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${EXT[real]}`;
  const stored = await store(provider, key, buf, real);
  if (stored) return stored;

  const media = await insertMedia({
    provider, object_key: key, embed_id: '', mime: real, bytes: buf.byteLength,
    width: width ?? null, height: height ?? null, alt, filename: file.name.replace(/[^\w.\- ]+/g, '').slice(0, 120),
  });
  return json({ media }, { status: 201 });
};

/** Upload to storage; a storage problem becomes a clear message in the admin instead of a bare 500. */
async function store(provider: Parameters<typeof putObject>[0], key: string, buf: ArrayBuffer, mime: string): Promise<Response | null> {
  try {
    await putObject(provider, key, buf, mime);
    return null;
  } catch (e) {
    if (e instanceof StorageError) return error(502, e.message);
    throw e;
  }
}
