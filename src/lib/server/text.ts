// SERVER-ONLY text helpers: escaping, entity decoding, read time.
import type { DocNode } from '../shared/types';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape for HTML text and double/single-quoted attribute values. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Escape for XML (RSS). */
export function escXml(value: unknown): string {
  return esc(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©',
};

/** Turn WordPress HTML (title/excerpt) into plain text. Output must still be escaped when rendered. */
export function htmlToText(html: string, maxLen = 0): string {
  let text = String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .replace(/\s*\[(?:…|&hellip;|\.\.\.)\]\s*$/, '')
    .trim();
  if (maxLen && text.length > maxLen) text = text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return text;
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ' ';
  return String.fromCodePoint(n);
}

export function docText(node: DocNode | undefined, depth = 0): string {
  if (!node || depth > 50) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map((c) => docText(c, depth + 1)).join(' ');
}

/** Words of the author's own text in a document (captions and alt text are not counted). */
export function wordCount(doc: DocNode | undefined): number {
  return docText(doc).split(/\s+/).filter(Boolean).length;
}

export function readMinutes(doc: DocNode): number {
  const words = wordCount(doc);
  return Math.max(1, Math.round(words / 220));
}

export function formatDate(iso: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-SG', { ...opts, timeZone: 'Asia/Singapore' }).format(d);
}
