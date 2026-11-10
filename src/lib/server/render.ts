// SERVER-ONLY. Renders editor JSON (Tiptap/ProseMirror) to HTML through a strict
// allow-list. Unknown nodes, marks and attributes are dropped; every string is
// escaped; links and embeds are checked against fixed patterns. This is the
// only path by which stored content becomes HTML — there is no raw-HTML block.
import type { DocNode } from '../shared/types';
import { embedSrc, isSafeHref, osmEmbedSrc, osmLink, UUID_RE, validMapPoint } from '../shared/safe';
import { esc } from './text';
import { docTypeFor, formatBytes } from '../shared/files';

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

/** Validated attrs shared by the file nodes. The name is the author's label; the MIME only picks a badge. */
function fileAttrs(a: Record<string, unknown>) {
  const id = typeof a.mediaId === 'string' && UUID_RE.test(a.mediaId) ? a.mediaId : '';
  const name = (typeof a.name === 'string' ? a.name : '').slice(0, 140) || 'File';
  const bytes = typeof a.bytes === 'number' && Number.isFinite(a.bytes) ? a.bytes : 0;
  const t = docTypeFor(typeof a.mime === 'string' ? a.mime : '', name);
  return { id, name, bytes, t };
}

const DL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

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

const MAX_GALLERY = 30;
// Lightbox group ids only need to be unique within a page; a running counter also keeps two documents
// rendered on the same page (e.g. a story and its sidebar) from sharing a group.
let galleryCount = 0;

interface GalleryItem { id: string; alt: string; w: number; h: number }

function galleryItem(raw: unknown): GalleryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const it = raw as Record<string, unknown>;
  const id = typeof it.mediaId === 'string' && UUID_RE.test(it.mediaId) ? it.mediaId : '';
  if (!id) return null;
  const alt = typeof it.alt === 'string' ? it.alt.trim().slice(0, 300) : '';
  const w = Math.round(num(it.w, 0, 20000, 0));
  const h = Math.round(num(it.h, 0, 20000, 0));
  return { id, alt, w: w && h ? w : 0, h: w && h ? h : 0 };
}

function renderNode(node: DocNode, depth: number): string {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return '';
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'doc':
      return children(node, depth);
    case 'text':
      return typeof node.text === 'string' ? renderMarks(node.text, node.marks) : '';
    case 'fileLink': {
      const f = fileAttrs(a);
      if (!f.id) return '';
      return `<a class="file-link" href="/media/${f.id}" download><span class="file-badge" style="--c:${f.t.color}" aria-hidden="true">${esc(f.t.badge)}</span>${esc(f.name)}<span class="sr-only"> (${esc(f.t.label)}${f.bytes ? `, ${formatBytes(f.bytes)}` : ''}, download)</span></a>`;
    }
    case 'file': {
      const f = fileAttrs(a);
      if (!f.id) return '';
      const action = f.t.badge === 'ICS' ? 'Add to calendar' : 'Download';
      return `<a class="file-card" href="/media/${f.id}" download><span class="file-badge" style="--c:${f.t.color}" aria-hidden="true">${esc(f.t.badge)}</span><span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${esc(f.t.label)}${f.bytes ? ` · ${formatBytes(f.bytes)}` : ''}</span></span><span class="file-action">${action} ${DL_ICON}</span></a>`;
    }
    case 'pdf': {
      // Server HTML is the no-JavaScript fallback: a card (with a download link only if allowed).
      // public/pdf-viewer enhances [data-pdf] into a page-by-page preview.
      const f = fileAttrs({ ...a, mime: 'application/pdf' });
      if (!f.id) return '';
      const dl = a.download === true;
      const url = `/media/${f.id}`;
      return `<figure class="pdf" data-pdf="${url}" data-download="${dl ? '1' : '0'}" data-size="${esc(formatBytes(f.bytes))}" aria-label="${esc(`PDF: ${f.name}`)}"><div class="pdf-bar"><span class="file-badge" style="--c:${f.t.color}" aria-hidden="true">PDF</span><span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta pdf-meta">PDF${f.bytes ? ` · ${formatBytes(f.bytes)}` : ''}</span></span><span class="pdf-tools">${
        dl ? `<a class="btn pdf-dl" href="${url}" download aria-label="${esc(`Download ${f.name}`)}">${DL_ICON}<span class="pdf-dl-label">Download</span></a>` : ''
      }</span></div><div class="pdf-well"><p class="pdf-note">${dl ? 'Loading the preview…' : 'The preview needs JavaScript.'}</p></div></figure>`;
    }
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
      // The image sits in a button so the lightbox works by keyboard as well as by tap.
      return `<figure class="fig fig-${size}"><button type="button" class="lb" data-lightbox data-caption="${esc(caption || alt)}" aria-label="${esc(alt ? `View photo: ${alt}` : 'View photo')}"><img src="/media/${id}" alt="${esc(alt)}" loading="lazy" decoding="async" draggable="false"></button>${
        caption ? `<figcaption>${esc(caption)}</figcaption>` : ''
      }</figure>`;
    }
    case 'gallery': {
      // Grid (square crops, 2–4 columns) or masonry (natural shapes, CSS columns). Each photo opens the
      // lightbox, which steps through this gallery only. Everything is checked: ids must be UUIDs, text is
      // escaped, numbers clamped, and at most MAX_GALLERY photos are rendered.
      const items = (Array.isArray(a.items) ? a.items : [])
        .map((it: unknown) => galleryItem(it))
        .filter((it): it is GalleryItem => it !== null)
        .slice(0, MAX_GALLERY);
      if (!items.length) return '';
      const layout = a.layout === 'masonry' ? 'masonry' : 'grid';
      const cols = Math.round(num(a.columns, 2, 4, 3));
      const caption = typeof a.caption === 'string' ? a.caption.trim().slice(0, 500) : '';
      const group = `g${++galleryCount}`;
      const photos = items
        .map((it, i) => {
          const label = it.alt ? `View photo ${i + 1} of ${items.length}: ${it.alt}` : `View photo ${i + 1} of ${items.length}`;
          const size = it.w && it.h ? ` width="${it.w}" height="${it.h}"` : '';
          return `<li><button type="button" class="lb" data-lightbox data-lb-group="${group}" data-caption="${esc(it.alt || caption)}" aria-label="${esc(label)}"><img src="/media/${it.id}" alt="${esc(it.alt)}"${size} loading="lazy" decoding="async" draggable="false"></button></li>`;
        })
        .join('');
      return `<figure class="gallery gallery-${layout} gallery-c${cols}"${caption ? '' : ` aria-label="Photo gallery, ${items.length} photos"`}><ul class="gallery-list">${photos}</ul>${
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
