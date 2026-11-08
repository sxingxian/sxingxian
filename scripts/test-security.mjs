// Security regression tests for the content renderer, link allow-list,
// embed parsing and WordPress text cleaning. Run: npm run test:security
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
               export { isSafeHref, parseVideoUrl, embedSrc } from './src/lib/shared/safe.ts';
               export { htmlToText, esc } from './src/lib/server/text.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'error',
});
const { renderDoc, isSafeHref, parseVideoUrl, htmlToText, esc } = await import(out);
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
  assert.deepEqual(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ'), { provider: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseVideoUrl('https://vimeo.com/76979871'), { provider: 'vimeo', id: '76979871' });
  assert.equal(parseVideoUrl('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseVideoUrl('javascript:alert(1)'), null);
});

console.log('WordPress text cleaning');
t('strips tags and scripts from excerpts', () => {
  const s = htmlToText('<p>Hello <script>alert(1)</script><b>world</b> &amp; &#8217;friends&#8217; [&hellip;]</p>');
  assert.equal(s, 'Hello world & ’friends’');
  assert.ok(!esc(s).includes('<'));
});

console.log(`\n${passed} security tests passed.`);
