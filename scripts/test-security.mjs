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
               export { adsAllowedOn, adsLive } from './src/lib/server/ads.ts';`,
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
const { renderDoc, isSafeHref, parseVideoUrl, parseMapInput, isTikTokShortLink, htmlToText, esc, ac, sessionCookie, clearSessionCookie, SESSION_COOKIE, safeNext, loginSchema, userPatchSchema, settingsSchemas, adsAllowedOn, adsLive } = await import(out);
await rm(dir, { recursive: true, force: true });

let passed = 0;
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
  for (const p of ['/admin', '/admin/journal', '/api/admin/me', '/cv', '/about', '/privacy', '/media/x', '/rss.xml', '/ads.txt']) assert.equal(adsAllowedOn(p), false, p);
  for (const p of ['/', '/journal', '/journal/a-post', '/photos', '/aboutme']) assert.equal(adsAllowedOn(p), true, p);
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

console.log('WordPress text cleaning');
t('strips tags and scripts from excerpts', () => {
  const s = htmlToText('<p>Hello <script>alert(1)</script><b>world</b> &amp; &#8217;friends&#8217; [&hellip;]</p>');
  assert.equal(s, 'Hello world & ’friends’');
  assert.ok(!esc(s).includes('<'));
});

const ta = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

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
  assert.equal(safeNext('/admin/journal'), '/admin/journal');
  assert.equal(safeNext('/admin/edit/new?kind=post'), '/admin/edit/new?kind=post');
});
t('sign-in and user-update payloads are bounded', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(257) }).success, false);
  assert.equal(userPatchSchema.safeParse({ role: 'superuser' }).success, false);
  assert.equal(userPatchSchema.safeParse({ resetPassword: false }).success, false);
});

console.log(`\n${passed} security tests passed.`);
