// Builds a Telegram post from an entry. Shared by the server (what is sent) and the editor (the preview).
//
// Messages are written in simple markdown and sent as Telegram HTML: everything is HTML-escaped first, then
// only **bold**, _italic_, `code` and [text](https://…) become tags, so no other markup can get through.

import type { DocNode, EntryKind } from './types';

/** Telegram's limits, counted on the visible text: a photo caption, and a text message. */
export const CAPTION_MAX = 1024;
export const TEXT_MAX = 4096;
const EXCERPT_MAX = 300;

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock']);

/** The entry's text as paragraphs (headings, quotes and list items count as paragraphs). */
export function docParagraphs(doc: DocNode | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: DocNode, into: string[]) => {
    if (n.type === 'text') { into.push(n.text ?? ''); return; }
    if (n.type === 'hardBreak') { into.push('\n'); return; }
    if (BLOCKS.has(n.type) && n.type !== 'listItem' && n.type !== 'blockquote') {
      const buf: string[] = [];
      for (const c of n.content ?? []) walk(c, buf);
      const t = buf.join('').replace(/[ \t]+/g, ' ').trim();
      if (t) out.push(t);
      return;
    }
    for (const c of n.content ?? []) walk(c, into);
  };
  if (doc) walk(doc, []);
  return out;
}

/** The first few lines: whole paragraphs while they fit, else cut at a sentence or word, with "…". */
export function excerptOf(body: DocNode | null | undefined, dek: string, max = EXCERPT_MAX): string {
  const paras = docParagraphs(body);
  const src = paras.length ? paras.slice(0, 3).join('\n\n') : (dek ?? '').trim();
  if (src.length <= max) return src;
  const cut = src.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1).trimEnd();
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Simple markdown → Telegram HTML. Only b, i, code and http(s) links can come out. */
export function markdownToTelegramHtml(md: string): string {
  const links: string[] = [];
  // Links first, swapped for tokens, so formatting never reaches inside an address.
  let s = escapeHtml(md).replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()<>"]{1,500})\)/g, (_m, text: string, href: string) => {
    links.push(`<a href="${href.replace(/"/g, '&quot;')}">${inline(text)}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = inline(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '');
}

function inline(s: string): string {
  return s
    .replace(/`([^`\n]{1,500})`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]{1,500})\*\*/g, '<b>$1</b>')
    .replace(/(^|[^\w])_([^_\n]{1,500})_(?=[^\w]|$)/g, '$1<i>$2</i>');
}

/** What Telegram counts: the text without tags, entities decoded. */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;|&gt;|&amp;|&quot;/g, 'x').length;
}

export interface PostInput {
  kind: EntryKind;
  title: string;
  dek: string;
  body: DocNode | null;
  topics: string[];
  /** "Part 3 of Men's Talk", or ''. */
  series: string;
  url: string;
  /** The default message (with fill-ins), used when `custom` is null. */
  template: string;
  /** The entry's own message (markdown, no fill-ins), or null. */
  custom: string | null;
  button: string;
  /** The photo to attach, or null for a text-only post. */
  imageId: string | null;
}

export interface Post {
  html: string;
  /** null = text only (no photo, or a message too long to be a caption). */
  imageId: string | null;
  button: { text: string; url: string };
}

/** The default message filled in, as markdown: what "Write my own" starts from. */
export function fillTemplate(template: string, p: Pick<PostInput, 'title' | 'dek' | 'body' | 'topics' | 'series'>, excerptMax = EXCERPT_MAX): string {
  const vals: Record<string, string> = { title: p.title, excerpt: excerptOf(p.body, p.dek, excerptMax), topics: p.topics.join(', '), series: p.series };
  return template.replace(/\{(title|excerpt|topics|series)\}/g, (_m, k: string) => vals[k] ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

// The default message: the template's own markdown is formatted, the filled-in values are only escaped
// (a title with * or _ in it stays as typed).
function renderTemplate(template: string, p: PostInput, excerptMax: number): string {
  const vals: Record<string, string> = { title: p.title, excerpt: excerptOf(p.body, p.dek, excerptMax), topics: p.topics.join(', '), series: p.series };
  const html = markdownToTelegramHtml(template.replace(/\{(title|excerpt|topics|series)\}/g, (_m, k: string) => `\u0001${k}\u0001`));
  return html.replace(/\u0001(title|excerpt|topics|series)\u0001/g, (_m, k: string) => escapeHtml(vals[k] ?? '')).replace(/\n{3,}/g, '\n\n').trim();
}

export function buildPost(p: PostInput): Post {
  const button = { text: p.button, url: p.url };
  if (p.custom !== null) {
    const html = markdownToTelegramHtml(p.custom.trim());
    const len = visibleLength(html);
    // Too long for a caption: send it as text, without the photo.
    const imageId = p.imageId && len <= CAPTION_MAX ? p.imageId : null;
    return { html: len > TEXT_MAX ? html.slice(0, TEXT_MAX) : html, imageId, button };
  }
  const limit = p.imageId ? CAPTION_MAX : TEXT_MAX;
  let max = EXCERPT_MAX;
  let html = renderTemplate(p.template || '**{title}**\n\n{excerpt}', p, max);
  // Shorten the excerpt until the whole message fits.
  for (let i = 0; i < 6 && visibleLength(html) > limit && max > 40; i++) {
    max = Math.max(40, max - (visibleLength(html) - limit) - 20);
    html = renderTemplate(p.template, p, max);
  }
  if (visibleLength(html) > limit) html = escapeHtml(p.title).slice(0, limit);
  return { html, imageId: p.imageId, button };
}
