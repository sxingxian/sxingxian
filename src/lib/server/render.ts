// SERVER-ONLY. Renders editor JSON (Tiptap/ProseMirror) to HTML through a strict
// allow-list. Unknown nodes, marks and attributes are dropped; every string is
// escaped; links and embeds are checked against fixed patterns. This is the
// only path by which stored content becomes HTML — there is no raw-HTML block.
import type { DocNode } from '../shared/types';
import { embedSrc, isSafeHref, osmEmbedSrc, osmLink, UUID_RE, validMapPoint } from '../shared/safe';
import { esc } from './text';

const MAX_DEPTH = 40;

function renderMarks(text: string, marks: DocNode['marks']): string {
  let out = esc(text);
  if (!marks) return out;
  for (const m of marks) {
    switch (m.type) {
      case 'bold':
        out = `<strong>${out}</strong>`;
        break;
      case 'italic':
        out = `<em>${out}</em>`;
        break;
      case 'underline':
        out = `<u>${out}</u>`;
        break;
      case 'strike':
        out = `<s>${out}</s>`;
        break;
      case 'code':
        out = `<code>${out}</code>`;
        break;
      case 'link': {
        const href = m.attrs?.href;
        if (isSafeHref(href)) {
          const external = /^https:/i.test(href);
          out = `<a href="${esc(href)}"${external ? ' rel="noopener noreferrer" target="_blank"' : ''}>${out}</a>`;
        }
        break;
      }
      default:
        break; // unknown mark: keep text, drop formatting
    }
  }
  return out;
}

function children(node: DocNode, depth: number): string {
  return (node.content ?? []).map((c) => renderNode(c, depth + 1)).join('');
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function columnWidths(raw: unknown, count: number): number[] {
  const arr = Array.isArray(raw) ? raw.map((v) => num(v, 10, 90, 0)) : [];
  if (arr.length !== count || arr.some((v) => v === 0)) return Array(count).fill(Math.round(100 / count));
  return arr.map((v) => Math.round(v));
}

function renderNode(node: DocNode, depth: number): string {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return '';
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'doc':
      return children(node, depth);
    case 'text':
      return typeof node.text === 'string' ? renderMarks(node.text, node.marks) : '';
    case 'paragraph':
      return `<p>${children(node, depth)}</p>`;
    case 'heading': {
      const level = num(a.level, 1, 4, 2);
      return `<h${level}>${children(node, depth)}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${children(node, depth)}</ul>`;
    case 'orderedList': {
      const start = num(a.start, 1, 100000, 1);
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>${children(node, depth)}</ol>`;
    }
    case 'listItem':
      return `<li>${children(node, depth)}</li>`;
    case 'blockquote':
      return `<blockquote>${children(node, depth)}</blockquote>`;
    case 'codeBlock': {
      const lang = typeof a.language === 'string' && /^[a-z0-9+#-]{1,20}$/i.test(a.language) ? a.language : '';
      const text = (node.content ?? []).map((c) => (typeof c.text === 'string' ? c.text : '')).join('');
      return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(text)}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'hardBreak':
      return '<br>';
    case 'callout':
      return `<aside class="callout">${children(node, depth)}</aside>`;
    case 'figure': {
      const id = typeof a.mediaId === 'string' && UUID_RE.test(a.mediaId) ? a.mediaId : '';
      if (!id) return '';
      const size = a.size === 'wide' || a.size === 'full' ? a.size : 'normal';
      const alt = typeof a.alt === 'string' ? a.alt.slice(0, 300) : '';
      const caption = typeof a.caption === 'string' ? a.caption.slice(0, 500) : '';
      return `<figure class="fig fig-${size}"><img src="/media/${id}" alt="${esc(alt)}" loading="lazy" decoding="async">${
        caption ? `<figcaption>${esc(caption)}</figcaption>` : ''
      }</figure>`;
    }
    case 'embed': {
      const provider = a.provider === 'youtube' || a.provider === 'vimeo' || a.provider === 'tiktok' ? a.provider : null;
      const src = provider && typeof a.videoId === 'string' ? embedSrc(provider, a.videoId) : null;
      if (!src) return '';
      const portrait = provider === 'tiktok' || a.portrait === true;
      const caption = typeof a.caption === 'string' ? a.caption.slice(0, 300) : '';
      return `<figure class="embed${portrait ? ' portrait' : ''}"><div class="embed-frame"><iframe src="${esc(src)}" title="${esc(caption || 'Embedded video')}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture; encrypted-media" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div>${
        caption ? `<figcaption>${esc(caption)}</figcaption>` : ''
      }</figure>`;
    }
    case 'map': {
      const p = validMapPoint(a.lat, a.lon, a.zoom);
      if (!p) return '';
      const label = typeof a.label === 'string' ? a.label.slice(0, 120) : '';
      const caption = typeof a.caption === 'string' ? a.caption.slice(0, 300) : '';
      const text = [label, caption].filter(Boolean).join(' · ');
      return `<figure class="map"><div class="map-frame"><iframe src="${esc(osmEmbedSrc(p))}" title="${esc(label || 'Map')}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups"></iframe></div><figcaption>${
        text ? `${esc(text)} · ` : ''
      }<a href="${esc(osmLink(p))}" target="_blank" rel="noopener noreferrer">Open map ↗</a></figcaption></figure>`;
    }
    case 'columns': {
      const cols = (node.content ?? []).filter((c) => c?.type === 'column').slice(0, 3);
      if (cols.length < 2) return cols.map((c) => children(c, depth + 1)).join('');
      const widths = columnWidths(a.widths, cols.length);
      const stack = a.stackOnMobile === false ? '' : ' cols-stack';
      const divided = a.dividers === true ? ' cols-divided' : '';
      const gap = a.gap === 's' || a.gap === 'l' ? a.gap : 'm';
      return `<div class="cols cols-gap-${gap}${stack}${divided}" style="grid-template-columns:${widths
        .map((w) => `${w}fr`)
        .join(' ')}">${cols.map((c) => `<div class="col">${children(c, depth + 1)}</div>`).join('')}</div>`;
    }
    default:
      return ''; // unknown node: dropped
  }
}

export function renderDoc(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  return renderNode(doc as DocNode, 0);
}
