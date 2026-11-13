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
               export { adsAllowedOn, adsLive, adsLocked, adPlace, adPlaces } from './src/lib/server/ads.ts';
               export { imagesWithoutAlt } from './src/lib/shared/doc-checks.ts';
               export { stripInvisible } from './src/lib/shared/safe.ts';
               export { pageInputSchema } from './src/lib/shared/schemas.ts';
               export { AD_MIN_WORDS, DEFAULT_AD_PLACES } from './src/lib/shared/types.ts';
               export { watermarkSig, watermarkable, watermarkHasContent } from './src/lib/shared/watermark.ts';
               export { checkPng } from './src/lib/server/png.ts';
               export { sniffDocument, contentDisposition } from './src/lib/server/filetypes.ts';
               export { cleanFileName } from './src/lib/shared/files.ts';
               export { normalizeWpBase } from './src/lib/shared/safe.ts';
               export { cleanTopics, topicLabel } from './src/lib/shared/types.ts';
               export { entryInputSchema } from './src/lib/shared/schemas.ts';
               export { canonicalPath, isAdminPath } from './src/lib/server/paths.ts';
               export { topicFor, pickImage, safeImageUrl } from './src/lib/server/wptopic.ts';
               export { seriesInputSchema, entrySeriesSchema, viewInputSchema } from './src/lib/shared/schemas.ts';
               export { featuredIds } from './src/lib/shared/types.ts';
               export { entryContentSchema, entryStateSchema } from './src/lib/shared/schemas.ts';
               export { entryState, untilLabel, whenLabel } from './src/lib/shared/state.ts';
               export { partsLabel, laterParts, outWhen } from './src/lib/shared/series-text.ts';
               export { markdownToTelegramHtml, buildPost, excerptOf, visibleLength, CAPTION_MAX } from './src/lib/shared/telegram-format.ts';
               export { TELEGRAM_CHAT_RE, TELEGRAM_TOKEN_RE, settingsSchemas as SETTINGS_SCHEMAS } from './src/lib/shared/schemas.ts';
               export { sponsorCheckoutSchema, stripeConnectSchema, paypalConnectSchema } from './src/lib/shared/schemas.ts';
               export { parseMoney, formatMoney, amountProblem, cleanMessage, paypalMeUrl } from './src/lib/shared/sponsor.ts';
               export { verifyStripeSignature } from './src/lib/server/stripe-sig.ts';
               export { DEFAULT_SETTINGS, sponsorLive, paypalVia, sponsorCardTitle } from './src/lib/shared/types.ts';
               export { sponsorMarkSchema, PAYPAL_ME_RE } from './src/lib/shared/schemas.ts';
               export { readPaging, parsePage, parseSize, pageList, pageAfterResize, likePattern } from './src/lib/shared/paging.ts';
               export { entryTelegramSchema } from './src/lib/shared/schemas.ts';`,
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
const { renderDoc, isSafeHref, parseVideoUrl, parseMapInput, isTikTokShortLink, htmlToText, esc, ac, sessionCookie, clearSessionCookie, SESSION_COOKIE, safeNext, loginSchema, userPatchSchema, settingsSchemas, adsAllowedOn, adsLive, adsLocked, adPlace, adPlaces, imagesWithoutAlt, stripInvisible, pageInputSchema, AD_MIN_WORDS, DEFAULT_AD_PLACES, watermarkSig, watermarkable, watermarkHasContent, checkPng, sniffDocument, contentDisposition, cleanFileName, normalizeWpBase, cleanTopics, topicLabel, entryInputSchema, canonicalPath, isAdminPath, topicFor, pickImage, safeImageUrl, seriesInputSchema, entrySeriesSchema, viewInputSchema, featuredIds, entryContentSchema, entryStateSchema, entryState, untilLabel, whenLabel, partsLabel, laterParts, outWhen, markdownToTelegramHtml, buildPost, excerptOf, visibleLength, CAPTION_MAX, TELEGRAM_CHAT_RE, TELEGRAM_TOKEN_RE, SETTINGS_SCHEMAS, sponsorCheckoutSchema, stripeConnectSchema, paypalConnectSchema, parseMoney, formatMoney, amountProblem, cleanMessage, verifyStripeSignature, DEFAULT_SETTINGS, sponsorLive, paypalMeUrl, paypalVia, sponsorCardTitle, sponsorMarkSchema, PAYPAL_ME_RE, readPaging, parsePage, parseSize, pageList, pageAfterResize, likePattern, entryTelegramSchema } = await import(out);
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
const ALL_ON = { places: { story: true, home: true, lists: true, photos: true, film: true, work: true }, skipShort: false };
const LONG = { words: 5000 };
t('ads never run in the admin, API, CV, About, Contact, Privacy, sponsor pages or feeds, whatever the switches say', () => {
  for (const p of ['/admin', '/admin/stories', '/api/admin/me', '/cv', '/about', '/contact', '/privacy', '/privacy/', '/media/x', '/partials/home-feed', '/rss.xml', '/ads.txt', '/sitemap.xml', '/sponsor', '/sponsor/thanks', '/sponsor/cancelled']) {
    assert.equal(adsLocked(p), true, p);
    assert.equal(adPlace(p), null, p);
    assert.equal(adsAllowedOn(p, ALL_ON, LONG), false, p);
  }
});
t('a path that belongs to no place gets no ads (fails closed)', () => {
  for (const p of ['/aboutme', '/unknown', '/story/a/b', '/series/a/b/c', '/login']) assert.equal(adsAllowedOn(p, ALL_ON, LONG), false, p);
});
t('each path is governed by the right switch', () => {
  const cases = { '/': 'home', '/story': 'lists', '/story/': 'lists', '/series': 'lists', '/series/a-series': 'lists', '/story/a-post': 'story', '/photos': 'photos', '/photos/a-gallery': 'photos', '/film': 'film', '/film/a-film': 'film', '/work': 'work', '/work/a-project': 'work' };
  for (const [path, place] of Object.entries(cases)) {
    assert.equal(adPlace(path)?.place, place, path);
    const only = { places: { story: false, home: false, lists: false, photos: false, film: false, work: false, [place]: true }, skipShort: false };
    assert.equal(adsAllowedOn(path, only, LONG), true, `${path} on`);
    assert.equal(adsAllowedOn(path, { ...only, places: { ...ALL_ON.places, [place]: false } }, LONG), false, `${path} off`);
  }
});
t('by default only story pages carry ads', () => {
  assert.deepEqual(adPlaces({}), DEFAULT_AD_PLACES);
  assert.equal(adsAllowedOn('/story/a-post', {}, LONG), true);
  for (const p of ['/', '/story', '/series', '/photos', '/photos/x', '/film/x', '/work/x']) assert.equal(adsAllowedOn(p, {}, LONG), false, p);
  // Only real booleans count: junk in a saved value falls back to the default.
  assert.deepEqual(adPlaces({ places: { home: 'yes', story: 0, extra: true } }), DEFAULT_AD_PLACES);
});
t('short entries, error pages and hidden pages carry no ads', () => {
  const on = { ...ALL_ON, skipShort: true };
  assert.equal(adsAllowedOn('/story/a-post', on, { words: AD_MIN_WORDS }), true);
  assert.equal(adsAllowedOn('/story/a-post', on, { words: AD_MIN_WORDS - 1 }), false);
  assert.equal(adsAllowedOn('/photos/a-gallery', on, { words: 0 }), false);
  assert.equal(adsAllowedOn('/story/a-post', on, {}), false, 'an entry of unknown length counts as short');
  assert.equal(adsAllowedOn('/story/a-post', {}, { words: 10 }), false, 'skip short pages is on unless switched off');
  assert.equal(adsAllowedOn('/story/a-post', ALL_ON, { words: 10 }), true, 'switched off: short entries may carry ads');
  assert.equal(adsAllowedOn('/story', on, {}), true, 'lists have no length');
  assert.equal(adsAllowedOn('/story/a-post', ALL_ON, { ...LONG, blocked: true }), false);
  assert.equal(adsAllowedOn('/', ALL_ON, { blocked: true }), false);
});
t('ad place switches accept booleans only and fill in defaults', () => {
  const base = { enabled: false, client: '', homeSlot: '', articleSlot: '' };
  const d = settingsSchemas.ads.parse(base);
  assert.deepEqual(d.places, DEFAULT_AD_PLACES);
  assert.equal(d.skipShort, true);
  assert.equal(settingsSchemas.ads.parse({ ...base, places: { home: true } }).places.story, true);
  assert.equal(settingsSchemas.ads.safeParse({ ...base, places: { home: 'true' } }).success, false);
  assert.equal(settingsSchemas.ads.safeParse({ ...base, skipShort: 'no' }).success, false);
  assert.equal('admin' in settingsSchemas.ads.parse({ ...base, places: { admin: true } }).places, false, 'unknown places are dropped');
});
t('the contact switch defaults to off', () => {
  const s = settingsSchemas.sections.parse({ work: true, photos: true, film: true, cv: true, about: true });
  assert.equal(s.contact, false);
  assert.equal(settingsSchemas.sections.safeParse({ work: true, photos: true, film: true, cv: true, about: true, contact: 'yes' }).success, false);
});
t('invisible characters are removed from titles', () => {
  assert.equal(stripInvisible('The \u200BSanctum \u2060of \uFEFFthe \u00ADEye'), 'The Sanctum of the Eye');
  const entry = { kind: 'post', title: '\u200B Steel Meets \u200BShadow ', slug: 'steel', body: { type: 'doc', content: [] }, status: 'draft', is_public: false };
  assert.equal(entryInputSchema.parse(entry).title, 'Steel Meets Shadow');
  assert.equal(entryInputSchema.safeParse({ ...entry, title: '\u200B\uFEFF ' }).success, false, 'a title of only invisible characters is empty');
  assert.equal(pageInputSchema.parse({ title: 'Con\u200Btact', body: { type: 'doc', content: [] } }).title, 'Contact');
  // Joiners that emoji and some scripts need are kept.
  assert.equal(stripInvisible('a\u200Db\u200Cc'), 'a\u200Db\u200Cc');
});
t('photos without a description are counted', () => {
  const fig = (alt) => ({ type: 'figure', attrs: { mediaId: 'x', alt } });
  const d = doc(fig(''), fig('  '), fig('A harbour at dusk'), { type: 'gallery', attrs: { items: [{ alt: '' }, { alt: 'ok' }, null] } }, { type: 'columns', content: [{ type: 'column', content: [fig(undefined)] }] });
  assert.equal(imagesWithoutAlt(d), 5);
  assert.equal(imagesWithoutAlt(doc(p({ type: 'text', text: 'no photos' }))), 0);
  assert.equal(imagesWithoutAlt(undefined), 0);
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
t('publishing: autosave can never publish; only known actions; one state everywhere', () => {
  const content = { kind: 'post', title: 'T', slug: 't', body: { type: 'doc', content: [] } };
  // A save carrying status / visibility / date is accepted, but those fields are dropped.
  const r = entryContentSchema.safeParse({ ...content, status: 'published', is_public: true, published_at: '2026-01-01T00:00:00Z' });
  assert.equal(r.success, true);
  assert.equal('status' in r.data || 'is_public' in r.data || 'published_at' in r.data, false);
  assert.equal(entryStateSchema.safeParse({ action: 'publish' }).success, true);
  assert.equal(entryStateSchema.safeParse({ action: 'schedule', at: '2026-11-12T01:00:00.000Z' }).success, true);
  assert.equal(entryStateSchema.safeParse({ action: 'schedule', at: 'tomorrow' }).success, false);
  assert.equal(entryStateSchema.safeParse({ action: 'delete' }).success, false);
  assert.equal(entryStateSchema.safeParse({ action: 'publish', is_public: true }).data?.is_public, undefined);
  const now = Date.parse('2026-11-11T02:30:00Z');
  assert.equal(entryState({ status: 'draft', is_public: true, published_at: null }, now), 'draft');
  assert.equal(entryState({ status: 'published', is_public: false, published_at: '2026-11-01T00:00:00Z' }, now), 'draft');
  assert.equal(entryState({ status: 'published', is_public: true, published_at: '2026-11-11T15:00:00Z' }, now), 'scheduled');
  assert.equal(entryState({ status: 'published', is_public: true, published_at: '2026-11-01T00:00:00Z' }, now), 'published');
  assert.equal(entryState(null, now), 'draft');
  assert.equal(untilLabel('2026-11-11T15:00:00Z', now), 'in 12 h'); // 12½ hours: never "in 1 day"
  assert.equal(untilLabel('2026-11-11T02:50:00Z', now), 'in 20 min');
  assert.equal(untilLabel('2026-11-14T02:30:00Z', now), 'in 3 days');
  assert.equal(untilLabel('2026-11-10T02:30:00Z', now), '');
  assert.match(whenLabel('2026-11-11T03:00:00Z', now), /^Today, /);
});
t('series wording: one label everywhere; a scheduled part shows only when', () => {
  assert.equal(partsLabel(2, 5), '2 of 5 parts');
  assert.equal(partsLabel(3, null), '3 parts');
  assert.equal(partsLabel(1, 1), '1 part');
  assert.equal(partsLabel(2, 2, 4), '2 of 4 parts'); // a gap in part numbers still counts
  assert.equal(laterParts(3, 5), 'Parts 4 and 5');
  assert.equal(laterParts(4, 5), 'Part 5');
  assert.equal(laterParts(3, 9), 'Parts 4–9');
  assert.equal(laterParts(5, 5), '');
  const now = Date.parse('2026-11-11T07:00:00Z'); // 3 pm in Singapore
  assert.equal(outWhen('2026-11-11T15:00:00Z', now, 'Asia/Singapore'), 'tonight, 11:00 pm');
  assert.equal(outWhen('2026-11-11T08:00:00Z', now, 'Asia/Singapore'), 'today, 4:00 pm');
  assert.equal(outWhen('2026-11-12T01:00:00Z', now, 'Asia/Singapore'), 'tomorrow, 9:00 am');
  assert.equal(outWhen('2026-11-14T01:00:00Z', now, 'Asia/Singapore'), 'Saturday, 9:00 am');
  assert.equal(outWhen('2026-11-30T01:00:00Z', now, 'Asia/Singapore'), '30 Nov, 9:00 am');
});
t('telegram: messages can only carry b/i/code/http(s) links; titles are escaped; ids and tokens are checked', () => {
  const md = markdownToTelegramHtml;
  assert.equal(md('**b** _i_ `c` [x](https://a.example/p?q=1&r=2)'), '<b>b</b> <i>i</i> <code>c</code> <a href="https://a.example/p?q=1&amp;r=2">x</a>');
  assert.equal(md('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(md('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(md('[x](https://a.example/"onmouseover="y)').includes('<a'), false); // a quote can't break out of href: no link at all
  assert.equal(md('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(md('[l](https://a.example/_x_/)'), '<a href="https://a.example/_x_/">l</a>'); // no tags inside an address
  const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'word '.repeat(400) }] }] };
  const base = { kind: 'post', title: 'A <b> & "c"', dek: '', body, topics: [], series: '', url: 'https://x.example/story/a', template: '**{title}**\n\n{excerpt}', custom: null, button: 'Read', imageId: 'img' };
  const p = buildPost(base);
  assert.ok(p.html.startsWith('<b>A &lt;b&gt; &amp; "c"</b>'));
  assert.ok(visibleLength(p.html) <= CAPTION_MAX);
  assert.equal(buildPost({ ...base, custom: 'x'.repeat(1500) }).imageId, null); // too long for a caption: text only
  assert.ok(excerptOf(body, '', 100).length <= 101);
  for (const ok of ['@sxingxian_stories', '-1001234567890']) assert.equal(TELEGRAM_CHAT_RE.test(ok), true, ok);
  for (const bad of ['sxingxian', '@a', '-12345', "@x' or 1=1", 'https://t.me/x']) assert.equal(TELEGRAM_CHAT_RE.test(bad), false, bad);
  assert.equal(TELEGRAM_TOKEN_RE.test('123456789:AAHfakeTokenForQaOnly_0123456789abcdef'), true);
  assert.equal(TELEGRAM_TOKEN_RE.test('123:short'), false);
  // The settings never hold the token.
  const keys = Object.keys(SETTINGS_SCHEMAS.telegram.shape);
  assert.equal(keys.some((k) => /token|secret/i.test(k)), false);
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

t('WordPress featured image: best size, https only', () => {
  const sizes = (o) => ({ source_url: 'https://hey.example.com/full.jpg', media_details: { sizes: o } });
  assert.equal(pickImage(sizes({ medium_large: { source_url: 'https://hey.example.com/ml.jpg' }, large: { source_url: 'https://hey.example.com/l.jpg' } })), 'https://hey.example.com/ml.jpg');
  assert.equal(pickImage(sizes({ large: { source_url: 'https://hey.example.com/l.jpg' } })), 'https://hey.example.com/l.jpg');
  assert.equal(pickImage(sizes({})), 'https://hey.example.com/full.jpg');
  assert.equal(pickImage({ source_url: 'http://hey.example.com/a.jpg' }), 'https://hey.example.com/a.jpg'); // upgraded, not dropped
  assert.equal(pickImage(undefined), '');
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), '');
  assert.equal(safeImageUrl('https://user:pw@hey.example.com/a.jpg'), '');
  assert.equal(safeImageUrl('//hey.example.com/a.jpg'), '');
  assert.equal(safeImageUrl('https://hey.example.com/a b.jpg'), 'https://hey.example.com/a%20b.jpg');
});

t('featured stories: ids only, at most 8, old setting still read', () => {
  const f = settingsSchemas.featured;
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  assert.deepEqual(f.parse({ entryIds: [id(1), id(1), id(2)], order: 'custom' }).entryIds, [id(1), id(2)]); // de-duplicated
  assert.equal(f.safeParse({ entryIds: ['../etc/passwd'], order: 'date' }).success, false);
  assert.equal(f.safeParse({ entryIds: Array.from({ length: 9 }, (_, i) => id(i)), order: 'date' }).success, false);
  assert.equal(f.safeParse({ entryIds: [], order: 'random' }).success, false);
  assert.deepEqual(featuredIds({ mode: 'manual', entryId: id(5) }), [id(5)]); // previous release's value
  assert.deepEqual(featuredIds({ mode: 'latest', entryId: null }), []);
  assert.deepEqual(featuredIds({ entryIds: [id(1), 7, id(1)] }), [id(1)]);
});

t('footer links: "new tab" is a plain flag, URLs still allow-listed', () => {
  const footer = (link) => ({ about: '', columns: [{ heading: 'x', links: [link] }], bottomLine: '', showRss: true, showBuiltOn: false });
  assert.equal(settingsSchemas.footer.safeParse(footer({ label: 'A', url: 'https://a.example', newTab: true })).success, true);
  assert.equal(settingsSchemas.footer.safeParse(footer({ label: 'A', url: 'https://a.example', newTab: 'yes"><script>' })).success, false);
  assert.equal(settingsSchemas.footer.safeParse(footer({ label: 'A', url: 'javascript:alert(1)', newTab: true })).success, false);
});

t('series: address, text and part numbers bounded', () => {
  const ok = { title: 'Building', slug: 'building-sxingxian', description: '', planned_parts: 5, is_public: true };
  assert.equal(seriesInputSchema.safeParse(ok).success, true);
  for (const slug of ['Bad Slug', '../x', 'a--b', '-a', 'a'.repeat(81), '<b>']) assert.equal(seriesInputSchema.safeParse({ ...ok, slug }).success, false, slug);
  assert.equal(seriesInputSchema.safeParse({ ...ok, planned_parts: 0 }).success, false);
  assert.equal(seriesInputSchema.safeParse({ ...ok, planned_parts: 100 }).success, false);
  assert.equal(seriesInputSchema.safeParse({ ...ok, planned_parts: 2.5 }).success, false);
  assert.equal(seriesInputSchema.safeParse({ ...ok, title: '   ' }).success, false);
  assert.equal(seriesInputSchema.safeParse({ ...ok, description: 'x'.repeat(301) }).success, false);
  assert.equal(entrySeriesSchema.safeParse({ seriesId: 'not-a-uuid', part: 1 }).success, false);
  assert.equal(entrySeriesSchema.safeParse({ seriesId: null }).success, true);
  assert.equal(entrySeriesSchema.safeParse({ seriesId: '00000000-0000-4000-8000-000000000001', part: 100 }).success, false);
});

t('read counts: only a story id or a WordPress post number is accepted', () => {
  const ok = (item) => viewInputSchema.safeParse({ item }).success;
  assert.equal(ok('n:0d038776-413a-41e2-9840-e86da034c682'), true);
  assert.equal(ok('w:9001'), true);
  for (const bad of ['n:x', "n:0d038776-413a-41e2-9840-e86da034c682' OR 1=1", 'w:0', 'w:-1', 'w:1e5', 'w:' + '9'.repeat(13), 'x:1', '', 'N:0D038776-413A-41E2-9840-E86DA034C682'])
    assert.equal(ok(bad), false, bad);
});

t('gallery block: ids checked, text escaped, layout and size bounded', () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const gal = (attrs) => renderDoc({ type: 'doc', content: [{ type: 'gallery', attrs }] });
  const html = gal({ layout: 'masonry', columns: 2, caption: '<b>Trip</b>', items: [
    { mediaId: id(1), alt: '"><script>alert(1)</script>', w: 1600, h: 1000 },
    { mediaId: '../../etc/passwd', alt: 'x' },
    { mediaId: id(2), alt: 'Second', w: 'NaN', h: 5 },
    'junk', null,
  ] });
  assert.ok(!html.includes('<script>'), 'alt escaped');
  assert.ok(html.includes('&lt;b&gt;Trip&lt;/b&gt;'), 'caption escaped');
  assert.ok(!html.includes('passwd'), 'bad id dropped');
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.ok(html.includes('gallery-masonry gallery-c2'));
  assert.ok(html.includes('width="1600" height="1000"'));
  assert.ok(!/width="0"|height="5"/.test(html), 'size only when both valid');
  const g = html.match(/data-lb-group="(g\d+)"/g) || [];
  assert.equal(new Set(g).size, 1, 'one lightbox group per gallery');
  assert.ok(html.includes('aria-label="View photo 1 of 2:'));
  const odd = gal({ layout: 'carousel"><x', columns: 99, items: [{ mediaId: id(3) }] });
  assert.ok(odd.includes('gallery-grid gallery-c4'), 'unknown layout → grid; columns clamped');
  assert.ok(!odd.includes('<x'));
  const many = gal({ items: Array.from({ length: 45 }, (_, i) => ({ mediaId: id(i + 10) })) });
  assert.equal((many.match(/<img /g) || []).length, 30, 'at most 30 photos');
  assert.equal(gal({ items: [] }), '');
  assert.equal(gal({ items: 'nope' }), '');
  const two = renderDoc({ type: 'doc', content: [{ type: 'gallery', attrs: { items: [{ mediaId: id(1) }] } }, { type: 'gallery', attrs: { items: [{ mediaId: id(2) }] } }] });
  assert.equal(new Set(two.match(/data-lb-group="g\d+"/g)).size, 2, 'separate groups');
});

t('default cover: a media id only', () => {
  const site = (defaultCoverId) => ({ title: 'x', tagline: '', topics: [], defaultCoverId });
  assert.equal(settingsSchemas.site.safeParse(site('0d038776-413a-41e2-9840-e86da034c682')).success, true);
  assert.equal(settingsSchemas.site.safeParse(site(null)).success, true);
  for (const bad of ['../media/x', 'https://evil.example/x.jpg', '0d038776', 42]) assert.equal(settingsSchemas.site.safeParse(site(bad)).success, false, String(bad));
});

t('sponsor: amounts are whole cents, checked against the settings, never trusted from the browser', () => {
  assert.equal(parseMoney('15'), 1500);
  assert.equal(parseMoney('15.5'), 1550);
  assert.equal(parseMoney('S$15.50'), 1550);
  assert.equal(parseMoney(' 1,000 '), 100000);
  for (const bad of ['-5', '1e3', '15.555', '0x10', 'ten', '', '15.', 'NaN', 'Infinity', '99999999']) assert.equal(parseMoney(bad), null, bad);
  assert.equal(formatMoney(1000), 'S$10');
  assert.equal(formatMoney(1250), 'S$12.50');
  const s = { ...DEFAULT_SETTINGS.sponsor, amounts: [500, 1000, 2000], allowCustom: true, min: 300, max: 50000 };
  assert.equal(amountProblem(s, 1000), null);
  assert.equal(amountProblem(s, 1550), null, 'custom in range');
  assert.notEqual(amountProblem(s, 299), null, 'below the minimum');
  assert.notEqual(amountProblem(s, 50001), null, 'above the maximum');
  for (const bad of [0, -500, 1000.5, NaN, Infinity]) assert.notEqual(amountProblem(s, bad), null, String(bad));
  assert.notEqual(amountProblem({ ...s, allowCustom: false }, 1550), null, 'custom off: only the listed amounts');
  assert.equal(amountProblem({ ...s, allowCustom: false }, 2000), null);
  // What a page may send to start a payment.
  const ok = { method: 'stripe', amount: 1000, message: 'hi', from: null };
  assert.equal(sponsorCheckoutSchema.safeParse(ok).success, true);
  for (const bad of [{ ...ok, amount: 10.5 }, { ...ok, amount: '1000' }, { ...ok, amount: 0 }, { ...ok, amount: 99 }, { ...ok, amount: 2_000_000 }, { ...ok, method: 'bitcoin' },
    { ...ok, message: 'x'.repeat(601) }, { ...ok, from: '../../etc' }, { ...ok, from: 'javascript:alert(1)' }]) {
    assert.equal(sponsorCheckoutSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
  }
  // Sponsoring shows only when switched on AND a way to pay is connected.
  assert.equal(sponsorLive({ ...s, enabled: true, methods: { stripe: false, paypal: false } }), false);
  assert.equal(sponsorLive({ ...s, enabled: false, methods: { stripe: true, paypal: true } }), false);
  assert.equal(sponsorLive({ ...s, enabled: true, paypalMode: 'api', methods: { stripe: false, paypal: true } }), true);
});
t('sponsor: notes are plain text, no control or direction-flipping characters, at most 280', () => {
  assert.equal(cleanMessage('  hello\u0000 there\u202E  '), 'hello there');
  assert.equal(cleanMessage('a\r\n\n\n\nb'), 'a\n\nb');
  assert.equal(cleanMessage('x'.repeat(500)).length, 280);
  assert.equal(cleanMessage('<script>alert(1)</script>'), '<script>alert(1)</script>', 'kept as text; React and Astro escape it when shown');
});
await ta('sponsor: Stripe webhooks need a fresh, valid signature', async () => {
  const secret = 'whsec_test_123';
  const body = '{"type":"checkout.session.completed"}';
  const now = 1_800_000_000;
  const sign = async (t, b, key = secret) => {
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return Buffer.from(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${b}`))).toString('hex');
  };
  const good = await sign(now, body);
  assert.equal(await verifyStripeSignature(secret, `t=${now},v1=${good}`, body, now), true);
  assert.equal(await verifyStripeSignature(secret, `t=${now},v1=${'0'.repeat(64)},v1=${good}`, body, now), true, 'any listed v1 may match');
  assert.equal(await verifyStripeSignature(secret, `t=${now},v1=${good}`, body.replace('completed', 'expired'), now), false, 'body changed');
  assert.equal(await verifyStripeSignature(secret, `t=${now},v1=${good}`, body, now + 301), false, 'too old: replay');
  assert.equal(await verifyStripeSignature(secret, `t=${now},v1=${good}`, body, now - 301), false, 'from the future');
  assert.equal(await verifyStripeSignature(secret, `t=${now},v1=${await sign(now, body, 'whsec_other')}`, body, now), false, 'other secret');
  assert.equal(await verifyStripeSignature(secret, `t=${now + 1},v1=${good}`, body, now), false, 'timestamp swapped');
  for (const h of [null, '', `v1=${good}`, `t=${now}`, `t=abc,v1=${good}`, `t=${now},v0=${good}`, 'x'.repeat(2000)]) assert.equal(await verifyStripeSignature(secret, h, body, now), false, String(h).slice(0, 30));
  assert.equal(await verifyStripeSignature('', `t=${now},v1=${good}`, body, now), false, 'no secret stored');
});
t('sponsor: settings hold no keys, and amounts stay consistent', () => {
  const sch = SETTINGS_SCHEMAS.sponsor;
  const base = { ...DEFAULT_SETTINGS.sponsor };
  assert.equal(sch.safeParse(base).success, true);
  assert.equal(JSON.stringify(Object.keys(base)).match(/key|secret|token/i), null);
  for (const bad of [{ ...base, defaultAmount: 1500 }, { ...base, min: 5000, max: 300 }, { ...base, amounts: [500, 1000, 1500, 2000, 2500] }, { ...base, amounts: [] },
    { ...base, amounts: [1000, 1000], defaultAmount: 1000 }, { ...base, amounts: [50], defaultAmount: 50 }, { ...base, pageTitle: '' }, { ...base, cardText: 'x'.repeat(301) }]) {
    assert.equal(sch.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(stripeConnectSchema.safeParse({ key: 'rk_live_' + 'a'.repeat(30) }).success, true);
  for (const k of ['pk_live_' + 'a'.repeat(30), 'rk_live_short', 'rk_live_' + 'a'.repeat(30) + '/../x', 'whsec_abc']) assert.equal(stripeConnectSchema.safeParse({ key: k }).success, false, k);
  assert.equal(paypalConnectSchema.safeParse({ clientId: 'A'.repeat(40), secret: 'B'.repeat(40), mode: 'live' }).success, true);
  assert.equal(paypalConnectSchema.safeParse({ clientId: 'A'.repeat(40), secret: 'B b'.repeat(20), mode: 'live' }).success, false);
});

t('sponsor: PayPal.Me links are built only from a checked name and amount', () => {
  assert.equal(paypalMeUrl('sxingxian', 1000), 'https://www.paypal.com/paypalme/sxingxian/10SGD');
  assert.equal(paypalMeUrl('sxingxian', 1250), 'https://www.paypal.com/paypalme/sxingxian/12.50SGD');
  for (const bad of ['../evil', 'a b', 'x'.repeat(21), 'name?x=1', 'name/../../', '', 'javascript:alert(1)']) {
    assert.equal(PAYPAL_ME_RE.test(bad) && bad.length > 0, false, bad);
    assert.equal(paypalMeUrl(bad, 1000), 'https://www.paypal.com/paypalme', bad);
  }
  assert.equal(paypalMeUrl('ok', 10.5), 'https://www.paypal.com/paypalme');
  const s = { ...DEFAULT_SETTINGS.sponsor, methods: { stripe: false, paypal: false } };
  assert.equal(paypalVia({ ...s, paypalMode: 'me', paypalMe: '' }), null, 'no name: no PayPal');
  assert.equal(paypalVia({ ...s, paypalMode: 'me', paypalMe: 'sxingxian' }), 'me');
  assert.equal(paypalVia({ ...s, paypalMode: 'me', paypalMe: '../x' }), null);
  assert.equal(paypalVia({ ...s, paypalMode: 'api', paypalMe: 'sxingxian' }), null, 'API mode needs a connected app');
  assert.equal(sponsorLive({ ...s, paypalMode: 'me', paypalMe: 'sxingxian' }), true);
  assert.equal(SETTINGS_SCHEMAS.sponsor.safeParse({ ...DEFAULT_SETTINGS.sponsor, paypalMe: 'a/b' }).success, false);
  assert.equal(SETTINGS_SCHEMAS.sponsor.safeParse({ ...DEFAULT_SETTINGS.sponsor, cardKinds: ['post', 'admin'] }).success, false);
  // Marking a PayPal.Me sponsor: received needs a real amount.
  assert.equal(sponsorMarkSchema.safeParse({ action: 'received', amount: 1000 }).success, true);
  for (const bad of [{ action: 'received' }, { action: 'received', amount: 10.5 }, { action: 'received', amount: -1 }, { action: 'paid', amount: 1000 }]) assert.equal(sponsorMarkSchema.safeParse(bad).success, false, JSON.stringify(bad));
  // The card's heading fits each kind of page; a heading saved before {this} still reads right.
  assert.equal(sponsorCardTitle(DEFAULT_SETTINGS.sponsor, 'gallery'), 'Enjoyed these photos?');
  assert.equal(sponsorCardTitle({ ...DEFAULT_SETTINGS.sponsor, cardTitle: 'Enjoyed this story?' }, 'film'), 'Enjoyed this film?');
  assert.equal(sponsorCardTitle({ ...DEFAULT_SETTINGS.sponsor, cardTitle: 'Like it?' }, 'project'), 'Like it?');
});

t('paging: page and size from the address are clamped to safe values', () => {
  for (const s of ['10', '25', '50', '100']) assert.equal(parseSize(s), Number(s));
  for (const bad of [null, '', '0', '-10', '11', '1000', '10.5', '1e2', ' 25', '25abc', 'NaN']) assert.equal(parseSize(bad), 10, String(bad));
  assert.equal(parsePage('3'), 3);
  for (const bad of [null, '', '0', '-1', '1.5', 'x', '1e3', '999999', '9'.repeat(40), "1' OR 1=1"]) assert.ok(parsePage(bad) >= 1 && parsePage(bad) <= 10000, String(bad));
  assert.equal(parsePage('99999'), 10000);
  const p = readPaging(new URLSearchParams('page=4&size=25&logpage=2&logsize=999'));
  assert.deepEqual(p, { page: 4, size: 25, offset: 75 });
  assert.deepEqual(readPaging(new URLSearchParams('page=4&size=25&logpage=2&logsize=999'), 'log'), { page: 2, size: 10, offset: 10 });
  // Search text: % and _ are literal, backslash escaped.
  assert.equal(likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
  // Page buttons and keeping the first row in view.
  assert.deepEqual(pageList(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageList(2, 15), [1, 2, 3, 4, 5, 'gap', 15]);
  assert.deepEqual(pageList(7, 15), [1, 'gap', 6, 7, 8, 'gap', 15]);
  assert.deepEqual(pageList(15, 15), [1, 'gap', 11, 12, 13, 14, 15]);
  assert.equal(pageAfterResize(3, 10, 25), 1);
  assert.equal(pageAfterResize(1, 100, 10), 1);
  assert.equal(pageAfterResize(2, 25, 10), 3);
});

t('telegram: send silently is a plain yes / no / follow-the-default', () => {
  const base = { announce: true, message: null, image: 'cover' };
  assert.equal(entryTelegramSchema.parse(base).silent, null, 'missing = follow the default');
  for (const v of [true, false, null]) assert.equal(entryTelegramSchema.parse({ ...base, silent: v }).silent, v);
  for (const bad of ['yes', 1, 0, 'true', {}]) assert.equal(entryTelegramSchema.safeParse({ ...base, silent: bad }).success, false, String(bad));
  assert.equal(SETTINGS_SCHEMAS.telegram.parse({ ...DEFAULT_SETTINGS.telegram, silent: undefined }).silent, false);
  assert.equal(SETTINGS_SCHEMAS.telegram.safeParse({ ...DEFAULT_SETTINGS.telegram, silent: 'on' }).success, false);
});

console.log(`\n${passed} security tests passed.`);
