// PDF preview built on PDF.js (Apache-2.0). Enhances the server-rendered <figure class="pdf"> card:
//  - inline: the first two pages fitted to the column, then "Show all N pages";
//  - full screen (<dialog>): every page, zoom 50–200%, current page shown;
//  - pages are drawn only when they scroll into view, at the screen's pixel density (capped);
//  - each page's text is kept in a visually hidden block so screen readers can read it;
//  - "Download" appears only when the author allowed it (data-download="1").
// Built with DOM methods and textContent only: nothing from the PDF is inserted as HTML.
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerSrc;

const ASSETS = '/pdfjs/'; // copied from pdfjs-dist at build time (scripts/copy-pdfjs.mjs)
const MEDIA_URL = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INLINE_PAGES = 2;
const MAX_PIXELS = 4_000_000; // per canvas; keeps phones from running out of memory

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}
/** appendChild for several nodes (the Workers type definitions shadow Element.append here). */
function add(parent: Node, ...nodes: Node[]): void {
  for (const n of nodes) parent.appendChild(n);
}

const ICON_FS = 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
const ICON_DL = 'M12 4v11M7 10l5 5 5-5M5 20h14';

interface PageSlot {
  index: number;
  box: HTMLElement;
  canvas: HTMLCanvasElement;
  drawnWidth: number;
  drawing: boolean;
}

/** Draws pages into slots when they come into view; redraws when the width changes. */
class PageSet {
  slots: PageSlot[] = [];
  private io: IntersectionObserver;
  private visible = new Set<PageSlot>();
  constructor(
    private doc: PDFDocumentProxy,
    private host: HTMLElement,
    private width: () => number,
    private ratio: number,
    private label: string,
    private noSave: boolean,
    root: Element | null = null,
  ) {
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const slot = this.slots.find((s) => s.box === e.target);
        if (!slot) continue;
        if (e.isIntersecting) { this.visible.add(slot); void this.draw(slot); } else this.visible.delete(slot);
      }
    }, { root, rootMargin: '400px 0px' });
    for (let i = 1; i <= doc.numPages; i++) this.slots.push(this.makeSlot(i));
  }
  private makeSlot(index: number): PageSlot {
    const box = el('section', 'pdf-page');
    box.setAttribute('aria-label', `${this.label}, page ${index} of ${this.doc.numPages}`);
    box.style.aspectRatio = String(this.ratio);
    const canvas = el('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    if (this.noSave) canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    box.appendChild(canvas);
    this.host.appendChild(box);
    this.io.observe(box);
    return { index, box, canvas, drawnWidth: 0, drawing: false };
  }
  async draw(slot: PageSlot): Promise<void> {
    const cssWidth = Math.max(120, Math.round(this.width()));
    if (slot.drawing || Math.abs(slot.drawnWidth - cssWidth) < 2) return;
    slot.drawing = true;
    try {
      const page: PDFPageProxy = await this.doc.getPage(slot.index);
      const base = page.getViewport({ scale: 1 });
      slot.box.style.aspectRatio = String(base.width / base.height);
      let scale = (cssWidth / base.width) * Math.min(2, window.devicePixelRatio || 1);
      const px = base.width * base.height * scale * scale;
      if (px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
      const viewport = page.getViewport({ scale });
      const canvas = el('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      if (this.noSave) canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      slot.canvas.replaceWith(canvas);
      slot.canvas = canvas;
      slot.drawnWidth = cssWidth;
      if (!slot.box.querySelector('.sr-only')) {
        const text = await page.getTextContent();
        const words = text.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim();
        if (words) slot.box.appendChild(el('div', 'sr-only', words.slice(0, 20000)));
      }
      page.cleanup();
    } catch {
      slot.box.classList.add('pdf-page-error');
    } finally {
      slot.drawing = false;
    }
  }
  redrawVisible(): void {
    this.visible.forEach((s) => void this.draw(s));
  }
  destroy(): void {
    this.io.disconnect();
    this.host.replaceChildren();
  }
}

function downloadLink(url: string, name: string, withLabel: boolean): HTMLAnchorElement {
  const a = el('a', 'btn pdf-dl');
  a.href = url;
  a.setAttribute('download', '');
  a.setAttribute('aria-label', `Download ${name}`);
  a.appendChild(icon(ICON_DL));
  if (withLabel) a.appendChild(el('span', 'pdf-dl-label', 'Download'));
  return a;
}

async function mount(fig: HTMLElement): Promise<void> {
  const url = fig.dataset.pdf ?? '';
  if (!MEDIA_URL.test(url)) return;
  const allowDownload = fig.dataset.download === '1';
  const name = fig.querySelector('.file-name')?.textContent?.trim() || 'PDF';
  const well = fig.querySelector<HTMLElement>('.pdf-well');
  const meta = fig.querySelector<HTMLElement>('.pdf-meta');
  const tools = fig.querySelector<HTMLElement>('.pdf-tools');
  if (!well || !tools) return;

  const note = well.querySelector<HTMLElement>('.pdf-note') ?? well.appendChild(el('p', 'pdf-note'));
  note.textContent = 'Loading the preview…';

  let doc: PDFDocumentProxy;
  try {
    doc = await getDocument({
      url,
      cMapUrl: `${ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      wasmUrl: `${ASSETS}wasm/`,
      iccUrl: `${ASSETS}iccs/`,
      disableRange: true,
      enableXfa: false,
    }).promise;
  } catch {
    note.textContent = allowDownload ? 'The preview couldn’t load. You can still download the PDF.' : 'The preview couldn’t load.';
    return;
  }

  const first = await doc.getPage(1);
  const vp = first.getViewport({ scale: 1 });
  const ratio = vp.width / vp.height;
  const n = doc.numPages;
  if (meta) meta.textContent = ['PDF', `${n} ${n === 1 ? 'page' : 'pages'}`, fig.dataset.size ?? ''].filter(Boolean).join(' · ');

  // --- inline pages ---
  note.remove();
  const pages = el('div', 'pdf-pages');
  well.appendChild(pages);
  const inlineWidth = () => Math.min(pages.clientWidth || well.clientWidth, 720);
  const inline = new PageSet(doc, pages, inlineWidth, ratio, name, !allowDownload);
  if (n > INLINE_PAGES) {
    fig.classList.add('pdf-collapsed');
    const more = el('button', 'btn pdf-more', `Show all ${n} pages`);
    more.type = 'button';
    more.addEventListener('click', () => {
      fig.classList.remove('pdf-collapsed');
      more.remove();
    });
    well.appendChild(more);
  }
  let lastW = inlineWidth();
  let t: ReturnType<typeof setTimeout> | undefined;
  new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => { const w = inlineWidth(); if (Math.abs(w - lastW) > 24) { lastW = w; inline.redrawVisible(); } }, 200);
  }).observe(pages);

  // --- full screen ---
  const fsBtn = el('button', 'btn pdf-fs-btn');
  fsBtn.type = 'button';
  fsBtn.appendChild(icon(ICON_FS));
  fsBtn.appendChild(el('span', 'pdf-fs-label', 'Full screen'));
  fsBtn.setAttribute('aria-label', `Open ${name} full screen`);
  tools.appendChild(fsBtn);

  let dialog: HTMLDialogElement | null = null;
  let full: PageSet | null = null;
  let zoom = 100;
  fsBtn.addEventListener('click', () => {
    if (!dialog) {
      dialog = el('dialog', 'pdf-fs');
      dialog.setAttribute('aria-label', name);
      const bar = el('div', 'pdf-fs-bar');
      const title = el('b', 'pdf-fs-title', name);
      const where = el('span', 'pdf-fs-where', `1 / ${n}`);
      where.setAttribute('aria-live', 'polite');
      const out = el('button', 'btn icon', '−'); out.type = 'button'; out.setAttribute('aria-label', 'Zoom out');
      const level = el('span', 'pdf-fs-zoom', '100%');
      const inn = el('button', 'btn icon', '+'); inn.type = 'button'; inn.setAttribute('aria-label', 'Zoom in');
      const close = el('button', 'btn', 'Close'); close.type = 'button';
      add(bar, title, where, out, level, inn);
      if (allowDownload) add(bar, downloadLink(url, name, false));
      add(bar, close);
      const scroller = el('div', 'pdf-fs-pages');
      add(dialog, bar, scroller);
      document.body.appendChild(dialog);
      const fullWidth = () => Math.min(820, scroller.clientWidth - 32) * (zoom / 100);
      full = new PageSet(doc, scroller, fullWidth, ratio, name, !allowDownload, scroller);
      const setZoom = (z: number) => {
        zoom = Math.max(50, Math.min(200, z));
        level.textContent = `${zoom}%`;
        scroller.style.setProperty('--pdf-w', `${Math.round(fullWidth())}px`);
        full?.redrawVisible();
      };
      out.addEventListener('click', () => setZoom(zoom - 25));
      inn.addEventListener('click', () => setZoom(zoom + 25));
      close.addEventListener('click', () => dialog?.close());
      dialog.addEventListener('close', () => { document.documentElement.classList.remove('pdf-fs-open'); fsBtn.focus(); });
      const pageIo = new IntersectionObserver((entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top && full) where.textContent = `${full.slots.findIndex((s) => s.box === top.target) + 1} / ${n}`;
      }, { root: scroller, threshold: 0.5 });
      full.slots.forEach((s) => pageIo.observe(s.box));
      requestAnimationFrame(() => setZoom(100));
    }
    document.documentElement.classList.add('pdf-fs-open');
    dialog.showModal();
  });
}

export function mountAll(figs: NodeListOf<HTMLElement>): void {
  figs.forEach((f) => void mount(f));
}
