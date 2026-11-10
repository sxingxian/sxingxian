// Security regression tests for the content renderer, link allow-list,
// embed parsing, WordPress text cleaning, and admin accounts (passwords,
// TOTP, encryption at rest, session cookies). Run: npm run test:security
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'sx-sec-'));
const out = join(dir, 'bundle.mjs');
await build({
  stdin: {
    contents: `export { renderDoc } from './src/lib/server/render.ts';
               export { isSafeHref, parseVideoUrl, embedSrc, parseMapInput, isTikTokShortLink } from './src/lib/shared/safe.ts';
               export { htmlToText, esc } from './src/lib/server/text.ts';
               export * as ac from './src/lib/server/authcrypto.ts';
               export { sessionCookie, clearSessionCookie, SESSION_COOKIE } from './src/lib/server/users.ts';
               export { safeNext } from './src/admin/auth/fields.tsx';
               export { loginSchema, userPatchSchema, settingsSchemas } from './src/lib/shared/schemas.ts';
               export { adsAllowedOn, adsLive } from './src/lib/server/ads.ts';
               export { watermarkSig, watermarkable, watermarkHasContent } from './src/lib/shared/watermark.ts';
               export { checkPng } from './src/lib/server/png.ts';
               export { sniffDocument, contentDisposition } from './src/lib/server/filetypes.ts';
               export { cleanFileName } from './src/lib/shared/files.ts';
               export { normalizeWpBase } from './src/lib/shared/safe.ts';
               export { cleanTopics, topicLabel } from './src/lib/shared/types.ts';
               export { entryInputSchema } from './src/lib/shared/schemas.ts';
               export { canonicalPath, isAdminPath } from './src/lib/server/paths.ts';
               export { topicFor } from './src/lib/server/wptopic.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error',
  jsx: 'automatic',
  // users.ts reads Worker settings; give it an empty stand-in so the pure helpers can be tested.
  plugins: [{ name: 'cf-stub', setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cf', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const env = {};', loader: 'js' }));
  } }],
});
const { renderDoc, isSafeHref, parseVideoUrl, parseMapInput, isTikTokShortLink, htmlToText, esc, ac, sessionCookie, clearSessionCookie, SESSION_COOKIE, safeNext, loginSchema, userPatchSchema, settingsSchemas, adsAllowedOn, adsLive, watermarkSig, watermarkable, watermarkHasContent, checkPng, sniffDocument, contentDisposition, cleanFileName, normalizeWpBase, cleanTopics, topicLabel, entryInputSchema, canonicalPath, isAdminPath, topicFor } = await import(out);
await rm(dir, { recursive: true, force: true });

let passed = 0;
async function ta(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
const doc = (...content) => ({ type: 'doc', content });
const p = (...content) => ({ type: 'paragraph', content });
const text = (s, marks) => ({ type: 'text', text: s, ...(marks ? { marks } : {}) });

console.log('Renderer');
t('escapes HTML in text', () => {
  const html = renderDoc(doc(p(text('<script>alert(1)</script><img src=x onerror=alert(1)>'))));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
});
t('drops unknown node types (no raw HTML block)', () => {
  const html = renderDoc(doc({ type: 'html', attrs: { html: '<script>x</script>' } }, { type: 'iframe', attrs: { src: 'https://evil' } }));
  assert.equal(html, '');
});
for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x', '//evil.com', '/\\evil.com', 'http://insecure.example', 'java\tscript:alert(1)']) {
  t(`rejects link ${JSON.stringify(href)}`, () => {
    const html = renderDoc(doc(p(text('x', [{ type: 'link', attrs: { href } }]))));
    assert.ok(!html.includes('<a '), html);
  });
}
t('keeps safe links and adds rel to external ones', () => {
  const html = renderDoc(doc(p(text('a', [{ type: 'link', attrs: { href: 'https://example.com/?q="x"' } }]), text('b', [{ type: 'link', attrs: { href: '/cv' } }]))));
  assert.ok(html.includes('href="https://example.com/?q=&quot;x&quot;"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('href="/cv"'));
});
t('attribute injection in figure alt/caption is escaped', () => {
  const html = renderDoc(doc({ type: 'figure', attrs: { mediaId: '123e4567-e89b-12d3-a456-426614174000', alt: '" onerror="alert(1)', caption: '<b>x</b>' } }));
  assert.ok(html.includes('alt="&quot; onerror=&quot;alert(1)"'));
  assert.ok(!html.includes('<b>'));
});
t('figure with a non-UUID media id is dropped', () => {
  assert.equal(renderDoc(doc({ type: 'figure', attrs: { mediaId: '../../etc/passwd' } })), '');
});
t('embed only renders YouTube/Vimeo IDs of the right shape', () => {
  assert.equal(renderDoc(doc({ type: 'embed', attrs: { provider: 'youtube', videoId: '"><script>' } })), '');
  assert.equal(renderDoc(doc({ type: 'embed', attrs: { provider: 'evil', videoId: 'dQw4w9WgXcQ' } })), '');
  const ok = renderDoc(doc({ type: 'embed', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' } }));
  assert.ok(ok.includes('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  assert.ok(ok.includes('sandbox='));
});
t('columns widths are numbers only (no CSS injection)', () => {
  const html = renderDoc(doc({ type: 'columns', attrs: { widths: ['1fr;background:url(//evil)', 50] }, content: [{ type: 'column', content: [p(text('a'))] }, { type: 'column', content: [p(text('b'))] }] }));
  assert.ok(!html.includes('evil'));
  assert.ok(html.includes('grid-template-columns:50fr 50fr'));
});
t('code block language is sanitised', () => {
  const html = renderDoc(doc({ type: 'codeBlock', attrs: { language: '"><script>' }, content: [text('<x>')] }));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;x&gt;'));
});
t('deeply nested documents are bounded', () => {
  let node = p(text('deep'));
  for (let i = 0; i < 500; i++) node = { type: 'blockquote', content: [node] };
  const html = renderDoc(doc(node));
  assert.ok(!html.includes('deep'));
});

console.log('Link allow-list');
t('allows https, mailto and site-relative', () => {
  for (const ok of ['https://github.com/sxingxian', 'mailto:hi@example.com', '/cv', '/rss.xml', '#top']) assert.ok(isSafeHref(ok), ok);
});
t('blocks dangerous schemes', () => {
  for (const bad of ['javascript:alert(1)', 'data:,x', 'http://x.com', '//x.com', 'ftp://x', '', 'https://', 'mailto:', 'https://a.com/\u0000']) assert.ok(!isSafeHref(bad), bad);
});

console.log('Video links');
t('parses known providers only', () => {
  assert.deepEqual(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ'), { provider: 'youtube', id: 'dQw4w9WgXcQ', portrait: false });
  assert.deepEqual(parseVideoUrl('https://vimeo.com/76979871'), { provider: 'vimeo', id: '76979871', portrait: false });
  assert.deepEqual(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { provider: 'youtube', id: 'dQw4w9WgXcQ', portrait: true });
  assert.deepEqual(parseVideoUrl('https://www.tiktok.com/@scout2015/video/6718335390845095173?lang=en'), { provider: 'tiktok', id: '6718335390845095173', portrait: true });
  assert.equal(parseVideoUrl('https://www.tiktok.com/@x/video/123"><script>'), null);
  assert.equal(parseVideoUrl('https://tiktok.com.evil.com/@x/video/6718335390845095173'), null);
  assert.equal(parseVideoUrl('http://www.tiktok.com/@x/video/6718335390845095173'), null);
  assert.equal(parseVideoUrl('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseVideoUrl('javascript:alert(1)'), null);
});

console.log('TikTok, Shorts and maps');
t('TikTok and Shorts embeds render portrait players from fixed hosts only', () => {
  const tt = renderDoc(doc({ type: 'embed', attrs: { provider: 'tiktok', videoId: '6718335390845095173' } }));
  assert.ok(tt.includes('src="https://www.tiktok.com/player/v1/6718335390845095173?rel=0&amp;description=1"'));
  assert.ok(tt.includes('class="embed portrait"') && tt.includes('sandbox='));
  assert.equal(renderDoc(doc({ type: 'embed', attrs: { provider: 'tiktok', videoId: 'abc' } })), '');
  const sh = renderDoc(doc({ type: 'embed', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', portrait: true } }));
  assert.ok(sh.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ') && sh.includes('portrait'));
});
t('TikTok share-link detection', () => {
  assert.ok(isTikTokShortLink('https://vm.tiktok.com/ZMabc123/'));
  assert.ok(isTikTokShortLink('https://www.tiktok.com/t/ZTabc/'));
  assert.ok(!isTikTokShortLink('https://vm.tiktok.com.evil.com/x'));
  assert.ok(!isTikTokShortLink('http://vm.tiktok.com/x'));
});
t('map block: only valid coordinates, fixed OpenStreetMap host, escaped label', () => {
  const html = renderDoc(doc({ type: 'map', attrs: { lat: 1.2834, lon: 103.8607, zoom: 16, label: '<b>Marina</b>"', caption: 'x' } }));
  assert.ok(html.includes('src="https://www.openstreetmap.org/export/embed.html?bbox='));
  assert.ok(html.includes('&lt;b&gt;Marina&lt;/b&gt;&quot;') && !html.includes('<b>'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  for (const bad of [{ lat: 'x', lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: '1;alert(1)', lon: 2 }, {}]) {
    assert.equal(renderDoc(doc({ type: 'map', attrs: bad })), '', JSON.stringify(bad));
  }
  const z = renderDoc(doc({ type: 'map', attrs: { lat: 1, lon: 1, zoom: 99 } }));
  assert.ok(z.includes('#map=19/'), 'zoom is clamped');
});
t('map input parsing: coordinates and map links', () => {
  assert.deepEqual(parseMapInput('1.2834, 103.8607'), { lat: 1.2834, lon: 103.8607, zoom: 15 });
  assert.deepEqual(parseMapInput('https://www.google.com/maps/place/X/@1.2834,103.8607,17z/data=x'), { lat: 1.2834, lon: 103.8607, zoom: 17 });
  assert.deepEqual(parseMapInput('https://www.openstreetmap.org/#map=14/1.29/103.85'), { lat: 1.29, lon: 103.85, zoom: 14 });
  assert.equal(parseMapInput('Marina Bay Sands'), null);
  assert.equal(parseMapInput('javascript:alert(1)'), null);
  assert.equal(parseMapInput('200, 500'), null);
});

console.log('AdSense');
t('ads never run in the admin, API, CV, About, Privacy or feeds', () => {
  for (const p of ['/admin', '/admin/stories', '/api/admin/me', '/cv', '/about', '/privacy', '/media/x', '/rss.xml', '/ads.txt']) assert.equal(adsAllowedOn(p), false, p);
  for (const p of ['/', '/story', '/story/a-post', '/photos', '/aboutme']) assert.equal(adsAllowedOn(p), true, p);
});
t('ads need a valid publisher ID and the switch on', () => {
  assert.equal(adsLive({ enabled: true, client: 'ca-pub-1234567890123456', homeSlot: '', articleSlot: '' }), true);
  assert.equal(adsLive({ enabled: false, client: 'ca-pub-1234567890123456', homeSlot: '', articleSlot: '' }), false);
  assert.equal(adsLive({ enabled: true, client: 'ca-pub-1"><script>', homeSlot: '', articleSlot: '' }), false);
});
t('ads settings reject script-shaped IDs', () => {
  const ok = { enabled: true, client: 'ca-pub-1234567890123456', homeSlot: '1234567890', articleSlot: '' };
  assert.equal(settingsSchemas.ads.safeParse(ok).success, true);
  assert.equal(settingsSchemas.ads.safeParse({ ...ok, client: 'ca-pub-12"onload=x' }).success, false);
  assert.equal(settingsSchemas.ads.safeParse({ ...ok, homeSlot: '123" data-x' }).success, false);
  assert.equal(settingsSchemas.ads.safeParse({ ...ok, client: '' }).success, false, 'cannot enable without an ID');
});

console.log('Photos');
await ta('watermark fingerprint changes with the look, not with the on/off switch', async () => {
  const base = { watermark: true, text: '© sxingxian', position: 'br', size: 'm', opacity: 0.4, blockSave: true };
  const a = await watermarkSig(base);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, await watermarkSig({ ...base, watermark: false, blockSave: false }));
  for (const change of [{ text: '© someone' }, { position: 'tiled' }, { size: 'l' }, { opacity: 0.5 }]) assert.notEqual(a, await watermarkSig({ ...base, ...change }), JSON.stringify(change));
});
await ta('watermark logo: text-only fingerprints are unchanged; the logo, its colour and on/off change it', async () => {
  const base = { watermark: true, text: '© sxingxian', position: 'br', size: 'm', opacity: 0.4, blockSave: true };
  const legacy = await watermarkSig(base);
  assert.equal(legacy, await watermarkSig({ ...base, logo: true, logoTint: 'original', logoHash: null }), 'no logo uploaded → same as before');
  assert.equal(legacy, await watermarkSig({ ...base, logo: false, logoTint: 'white', logoHash: 'abcdef0123456789' }), 'logo hidden → same as before');
  const withLogo = await watermarkSig({ ...base, logo: true, logoTint: 'original', logoHash: 'abcdef0123456789' });
  assert.notEqual(legacy, withLogo);
  assert.notEqual(withLogo, await watermarkSig({ ...base, logo: true, logoTint: 'white', logoHash: 'abcdef0123456789' }));
  assert.notEqual(withLogo, await watermarkSig({ ...base, logo: true, logoTint: 'original', logoHash: '0000000000000000' }));
  assert.ok(watermarkHasContent({ text: '', logo: true, logoHash: 'abcdef0123456789' }));
  assert.ok(!watermarkHasContent({ text: '  ', logo: true, logoHash: null }));
  assert.ok(!watermarkHasContent({ text: '', logo: false, logoHash: 'abcdef0123456789' }));
});
t('watermark settings never accept a logo hash from the browser', () => {
  const r = settingsSchemas.protection.safeParse({ watermark: true, text: '', position: 'br', size: 'm', opacity: 0.4, blockSave: true, logo: true, logoTint: 'white', logoHash: 'f'.repeat(16) });
  assert.ok(r.success);
  assert.equal('logoHash' in r.data, false);
  assert.equal(settingsSchemas.protection.safeParse({ watermark: true, text: 'x', position: 'br', size: 'm', opacity: 0.4, blockSave: true, logo: true, logoTint: 'pink' }).success, false);
});
t('watermark logo upload accepts only complete, bounded PNGs', () => {
  const png = (w, h, extra = []) => {
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255, 8, 6, 0, 0, 0, 0, 0, 0, 0];
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...iend, ...extra]);
  };
  const ok = checkPng(png(400, 120));
  assert.deepEqual(ok, { ok: true, width: 400, height: 120 });
  assert.equal(checkPng(png(2000, 100)).ok, false, 'too wide');
  assert.equal(checkPng(png(0, 100)).ok, false, 'zero size');
  assert.equal(checkPng(png(100, 100, [0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e])).ok, false, 'data appended after IEND');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(checkPng(svg).ok, false, 'SVG');
  const jpeg = new Uint8Array(64); jpeg.set([0xff, 0xd8, 0xff]);
  assert.equal(checkPng(jpeg).ok, false, 'JPEG');
  assert.equal(checkPng(new Uint8Array(300 * 1024)).ok, false, 'over 256 KB');
});
t('documents are accepted only when their contents match an allowed type', () => {
  const enc = (t) => new TextEncoder().encode(t);
  const zip = (names) => enc('PK\u0003\u0004' + '\u0000'.repeat(26) + names.join('\u0000') + '\u0000');
  assert.deepEqual(sniffDocument(enc('%PDF-1.7\n…'), 'a.pdf'), { ok: true, ext: 'pdf', mime: 'application/pdf' });
  assert.equal(sniffDocument(enc('<html><script>alert(1)</script>'), 'a.pdf').ok, false, 'HTML named .pdf');
  assert.equal(sniffDocument(enc('%PDF-1.7'), 'a.html').ok, false, 'html extension not allowed');
  assert.equal(sniffDocument(enc('<svg onload=alert(1)>'), 'a.svg').ok, false, 'svg not allowed');
  assert.equal(sniffDocument(zip(['[Content_Types].xml', 'word/document.xml']), 'a.docx').ok, true);
  assert.equal(sniffDocument(zip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']), 'a.docx').ok, false, 'macros');
  assert.equal(sniffDocument(zip(['[Content_Types].xml', 'xl/workbook.xml']), 'a.docx').ok, false, 'xlsx named docx');
  assert.equal(sniffDocument(zip(['anything']), 'a.zip').ok, false, 'zip not allowed');
  const odt = new Uint8Array([...enc('PK\u0003\u0004'), ...new Uint8Array(26), ...enc('mimetypeapplication/vnd.oasis.opendocument.text')]);
  assert.equal(sniffDocument(odt, 'a.odt').ok, true);
  assert.equal(sniffDocument(odt, 'a.ods').ok, false);
  assert.equal(sniffDocument(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'a.doc').ok, true);
  assert.equal(sniffDocument(enc('{\\rtf1 hello}'), 'a.rtf').ok, true);
  assert.equal(sniffDocument(enc('# Packing list\n- socks'), 'a.md').ok, true);
  assert.equal(sniffDocument(new Uint8Array([0x23, 0x00, 0x41]), 'a.md').ok, false, 'binary in text');
  assert.equal(sniffDocument(new Uint8Array([0xff, 0xfe, 0x41]), 'a.txt').ok, false, 'not UTF-8');
  assert.equal(sniffDocument(enc('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), 'a.ics').ok, true);
  assert.equal(sniffDocument(enc('<html>'), 'a.ics').ok, false);
});
t('file names are cleaned and downloads are always attachments', () => {
  assert.equal(cleanFileName('../../etc/passwd', 'txt'), 'passwd.txt');
  assert.equal(cleanFileName('C:\\Users\\x\\Trip "notes".docx', 'docx'), 'Trip notes.docx');
  assert.equal(cleanFileName('evil.html', 'pdf'), 'evil.pdf', 'extension forced to the real type');
  assert.equal(cleanFileName('\u0000\u001f', 'md'), 'file.md');
  const cd = contentDisposition('attachment', 'Ring Road "plan" (v2).pdf');
  assert.ok(cd.startsWith('attachment; filename="Ring Road _plan_ (v2).pdf"'));
  assert.ok(cd.includes("filename*=UTF-8''Ring%20Road%20%22plan%22%20%28v2%29.pdf"));
  assert.ok(!/[\r\n]/.test(contentDisposition('attachment', 'a\r\nSet-Cookie: x=1.txt')), 'no header injection');
});
t('WordPress address must be a public https site', () => {
  assert.equal(normalizeWpBase('https://hey.sxingxian.com/'), 'https://hey.sxingxian.com');
  assert.equal(normalizeWpBase('https://Example.org/blog/'), 'https://example.org/blog');
  assert.equal(normalizeWpBase('https://hey.sxingxian.com/a/../b'), 'https://hey.sxingxian.com/b', 'dot segments resolved by the URL parser');
  for (const bad of ['http://hey.sxingxian.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://10.0.0.5', 'https://nas.local', 'https://u:p@hey.sxingxian.com', 'https://hey.sxingxian.com:8443', 'https://hey.sxingxian.com/?x=1', 'https://intranet', 'javascript:alert(1)', 'https://a.internal']) {
    assert.equal(normalizeWpBase(bad), null, bad);
  }
});
t('file blocks render escaped, with download links only to our media route', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  const html = renderDoc({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'fileLink', attrs: { mediaId: id, name: '<img src=x onerror=alert(1)>.md', mime: 'text/markdown', bytes: 2048 } }] },
    { type: 'file', attrs: { mediaId: id, name: 'Dates.ics', mime: 'text/calendar', bytes: 4000 } },
    { type: 'file', attrs: { mediaId: 'javascript:alert(1)', name: 'x' } },
    { type: 'pdf', attrs: { mediaId: id, name: 'Plan.pdf', bytes: 1900000, download: false } },
    { type: 'pdf', attrs: { mediaId: id, name: 'Plan.pdf', download: 'yes' } },
  ] });
  assert.ok(!html.includes('<img'), 'name escaped');
  assert.ok(!html.includes('javascript:'), 'bad id dropped');
  assert.equal((html.match(/href="\/media\/11111111-2222-4333-8444-555555555555" download/g) ?? []).length, 2, 'link + card are downloads');
  assert.ok(html.includes('Add to calendar'));
  assert.ok(!html.includes('pdf-dl'), 'no download button unless download === true');
  assert.equal((html.match(/data-download="0"/g) ?? []).length, 2);
});
t('animated GIFs and video are never watermarked (would break them)', () => {
  for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) assert.ok(watermarkable(m), m);
  for (const m of ['image/gif', 'video/mp4', 'image/svg+xml', 'text/html']) assert.ok(!watermarkable(m), m);
});
t('photos open in the lightbox through a button; captions are escaped attributes', () => {
  const html = renderDoc(doc({ type: 'figure', attrs: { mediaId: '123e4567-e89b-12d3-a456-426614174000', alt: 'Rain', caption: '"><img src=x onerror=alert(1)>' } }));
  assert.ok(html.includes('<button type="button" class="lb" data-lightbox'));
  assert.ok(html.includes('draggable="false"'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('data-caption="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'));
});
t('protection settings are bounded', () => {
  const ok = { watermark: true, text: '© sxingxian', position: 'tiled', size: 's', opacity: 0.3, blockSave: true };
  assert.equal(settingsSchemas.protection.safeParse(ok).success, true);
  assert.equal(settingsSchemas.protection.safeParse({ ...ok, opacity: 1 }).success, false);
  assert.equal(settingsSchemas.protection.safeParse({ ...ok, position: 'top' }).success, false);
  assert.equal(settingsSchemas.protection.safeParse({ ...ok, text: 'x'.repeat(61) }).success, false);
});

console.log('WordPress text cleaning');
t('strips tags and scripts from excerpts', () => {
  const s = htmlToText('<p>Hello <script>alert(1)</script><b>world</b> &amp; &#8217;friends&#8217; [&hellip;]</p>');
  assert.equal(s, 'Hello world & ’friends’');
  assert.ok(!esc(s).includes('<'));
});



console.log('Admin accounts');
await ta('TOTP matches the RFC 6238 test vectors (SHA-1, 8 digits)', async () => {
  const secret = new TextEncoder().encode('12345678901234567890');
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [time, code] of vectors) assert.equal(await ac.totpAt(new Uint8Array(secret), Math.floor(time / 30), 8), code, String(time));
});
await ta('TOTP accepts ±1 step, rejects replays and older steps', async () => {
  const secret = ac.newTotpSecret();
  const now = Date.now();
  const step = Math.floor(now / 30000);
  const code = await ac.totpAt(secret, step);
  assert.equal(await ac.verifyTotp(secret, code, now, 0), step);
  assert.equal(await ac.verifyTotp(secret, code, now, step), null, 'same step twice must fail');
  assert.equal(await ac.verifyTotp(secret, await ac.totpAt(secret, step - 3), now, 0), null, 'old code must fail');
  assert.equal(await ac.verifyTotp(secret, '12345', now, 0), null);
  assert.equal(await ac.verifyTotp(secret, 'abcdef', now, 0), null);
});
await ta('base32 round-trips and rejects bad input', async () => {
  const b = ac.randomBytes(20);
  assert.deepEqual([...ac.base32Decode(ac.base32Encode(b))], [...b]);
  assert.equal(ac.base32Encode(new TextEncoder().encode('foobar')), 'MZXW6YTBOI');
  assert.throws(() => ac.base32Decode('not*base32'));
});
await ta('TOTP secrets are encrypted at rest and bound to the user', async () => {
  const key = 'k'.repeat(40);
  const secret = ac.newTotpSecret();
  const sealed = await ac.sealSecret(key, secret, 'user-a');
  assert.ok(sealed.startsWith('v1.') && !sealed.includes(ac.base32Encode(secret)));
  assert.deepEqual([...(await ac.openSecret(key, sealed, 'user-a'))], [...secret]);
  assert.equal(await ac.openSecret(key, sealed, 'user-b'), null, 'another user id must not decrypt');
  assert.equal(await ac.openSecret('x'.repeat(40), sealed, 'user-a'), null, 'wrong key must not decrypt');
  const [v, iv, ct] = sealed.split('.');
  const flipped = ct.slice(0, -2) + (ct.at(-2) === 'A' ? 'B' : 'A') + ct.at(-1);
  assert.equal(await ac.openSecret(key, [v, iv, flipped].join('.'), 'user-a'), null, 'tampering must be detected');
  assert.ok(ac.authSecretProblem('short'));
  assert.equal(ac.authSecretProblem('a'.repeat(32)), null);
});
await ta('password pre-hash is deterministic, 44 chars, and Unicode-normalised', async () => {
  const a = await ac.prehashPassword('correct horse battery');
  assert.equal(a.length, 44);
  assert.equal(a, await ac.prehashPassword('correct horse battery'));
  assert.notEqual(a, await ac.prehashPassword('correct horse batterY'));
  assert.equal(await ac.prehashPassword('caf\u00e9 au lait 12'), await ac.prehashPassword('cafe\u0301 au lait 12'));
  const long = 'x'.repeat(100) + 'a';
  assert.notEqual(await ac.prehashPassword(long), await ac.prehashPassword('x'.repeat(100) + 'b'), 'no 72-byte truncation');
});
t('password policy', () => {
  assert.ok(ac.passwordProblem('short'));
  assert.ok(ac.passwordProblem('password1234'));
  assert.ok(ac.passwordProblem('aaaaaaaaaaaaaaaa'));
  assert.ok(ac.passwordProblem('xingxian-garden-2026', 'xingxian@example.com'));
  assert.ok(ac.passwordProblem('x'.repeat(300)));
  assert.equal(ac.passwordProblem('tidal lantern copper moss'), null);
});
t('generated passwords, recovery codes and session tokens are random and well-formed', () => {
  const pw = new Set(Array.from({ length: 200 }, () => ac.randomPassword()));
  assert.equal(pw.size, 200);
  const group = /^[a-hjkmnp-z2-9]{5}$/;
  for (const p of pw) {
    const parts = p.split('-');
    assert.equal(parts.length, 4, p);
    for (const g of parts) assert.match(g, group, p);
  }
  const codes = ac.makeRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  const tok = ac.newSessionToken();
  assert.match(tok, ac.SESSION_TOKEN_RE);
  assert.notEqual(tok, ac.newSessionToken());
  assert.equal(ac.normaliseRecoveryCode(' ABCDE-fghjk '), 'abcdefghjk');
});
await ta('session tokens and recovery codes are stored only as hashes', async () => {
  const tok = ac.newSessionToken();
  const h = await ac.hashSessionToken(tok);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes(tok));
  assert.equal(await ac.hashRecoveryCode('ABCDE-FGHJK'), await ac.hashRecoveryCode('abcdefghjk'));
});
t('constant-time compare', () => {
  assert.ok(ac.safeEqual('abc', 'abc'));
  assert.ok(!ac.safeEqual('abc', 'abd'));
  assert.ok(!ac.safeEqual('abc', 'abcd'));
});
t('session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, Path=/', () => {
  const c = sessionCookie('t'.repeat(43));
  assert.ok(c.startsWith(`${SESSION_COOKIE}=`) && SESSION_COOKIE.startsWith('__Host-'));
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(part), part);
  assert.ok(!/Domain=/i.test(c));
  assert.ok(clearSessionCookie().includes('Max-Age=0'));
});
t('post-login redirect only goes to admin pages on this site', () => {
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/admin.evil.com', 'javascript:alert(1)', '/admin/login', '/admin/../x', '/admin\n']) assert.equal(safeNext(bad), '/admin', bad);
  assert.equal(safeNext('/admin/stories'), '/admin/stories');
  assert.equal(safeNext('/admin/edit/new?kind=post'), '/admin/edit/new?kind=post');
});
t('sign-in and user-update payloads are bounded', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(257) }).success, false);
  assert.equal(userPatchSchema.safeParse({ role: 'superuser' }).success, false);
  assert.equal(userPatchSchema.safeParse({ resetPassword: false }).success, false);
});

t('entry topics: cleaned, de-duplicated, capped; payload bounded', () => {
  assert.deepEqual(cleanTopics(['  Travel ', 'travel', 'Photo  graphy', '', 7, 'A', 'B']), ['Travel', 'Photo graphy', 'A']);
  assert.deepEqual(cleanTopics('Travel'), []);
  assert.equal(cleanTopics(['x'.repeat(80)])[0].length, 30);
  assert.deepEqual(cleanTopics(Array.from({ length: 20 }, (_, i) => `t${i}`), 12).length, 12);
  assert.equal(topicLabel(['Travel', 'Photography']), 'Travel · Photography');
  assert.equal(topicLabel(undefined), '');
  const base = { kind: 'post', title: 'T', slug: 't', body: { type: 'doc', content: [] }, status: 'draft', is_public: false };
  assert.equal(entryInputSchema.safeParse({ ...base, topics: ['a', 'b', 'c'] }).success, true);
  assert.equal(entryInputSchema.safeParse({ ...base, topics: ['a', 'b', 'c', 'd'] }).success, false);
  assert.equal(entryInputSchema.safeParse({ ...base, topics: ['x'.repeat(31)] }).success, false);
  assert.equal(entryInputSchema.safeParse({ ...base, topics: [''] }).success, false);
  assert.equal(entryInputSchema.safeParse({ ...base, topic: 'Legacy' }).success, true);
});
t('section topic lists are bounded', () => {
  const ok = { work: ['Web'], photos: [], film: [] };
  assert.equal(settingsSchemas.topics.safeParse(ok).success, true);
  assert.equal(settingsSchemas.topics.safeParse({ ...ok, work: Array.from({ length: 13 }, (_, i) => `t${i}`) }).success, false);
  assert.equal(settingsSchemas.topics.safeParse({ ...ok, film: [{}] }).success, false);
  assert.equal(settingsSchemas.topics.safeParse({ work: [] }).success, false);
});

t('admin paths cannot be disguised by encoding, dots or slashes', () => {
  for (const raw of ['/api/%61dmin/entries', '/%61dmin/', '/admin/../admin/users', '//admin//users', '/%2561dmin/x', '/api/admin/./entries', '/api\\admin/x', '/ADMIN/../admin']) {
    const c = canonicalPath(raw);
    assert.ok(c !== null && isAdminPath(c), `${raw} -> ${c}`);
  }
  assert.equal(canonicalPath('/admin/login'), '/admin/login');
  assert.equal(canonicalPath('/work/x'), '/work/x');
  assert.equal(isAdminPath(canonicalPath('/administrator')), false);
});
t('malformed or deeply encoded paths are refused', () => {
  assert.equal(canonicalPath('/%E0%A4%A'), null);
  assert.equal(canonicalPath('/a%00b'), null);
  assert.equal(canonicalPath('/%252525252561dmin'), null);
});

t('WordPress category → topic mapping', () => {
  const map = { Tech: 'Technology', Horror: 'Horror Series', Generic: 'Random Life', 'Tech & Life': 'Essays', __proto__x: 'X' };
  assert.equal(topicFor(['Tech'], map), 'Technology');
  assert.equal(topicFor(['tech '], map), 'Technology'); // case and spaces
  assert.equal(topicFor(['Tech &amp; Life'], map), 'Essays'); // WordPress sends entities
  assert.equal(topicFor(['Uncategorized', 'Horror'], map), 'Horror Series'); // any category, not just the first
  assert.equal(topicFor(['Travel', 'Generic'], map), 'Random Life'); // a mapped one wins over an unmapped one
  assert.equal(topicFor(['Travel'], map), 'Travel'); // unmapped keeps its name
  assert.equal(topicFor(['Uncategorized'], map), 'Notes');
  assert.equal(topicFor([], map), 'Notes');
  assert.equal(topicFor(['constructor', '__proto__'], {}), 'constructor'); // no prototype lookups
  assert.equal(topicFor(['Tech'], { Tech: '  ' }), 'Tech'); // blank mapping ignored
  assert.equal(topicFor(['x'.repeat(50)], {}).length, 30);
});

console.log(`\n${passed} security tests passed.`);
