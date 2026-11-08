// Draws watermarked public copies in the browser (canvas) and uploads them.
// Copies are capped at WM_MAX_EDGE px and saved as WebP (JPEG where WebP encoding isn't available).
import type { ProtectionSetting } from '../lib/shared/types';
import { WM_MAX_EDGE, logoActive, watermarkable } from '../lib/shared/watermark';

const SIZE = { s: 0.022, m: 0.032, l: 0.046 } as const;

/** A logo ready to draw: a bitmap or canvas, already tinted if needed. */
export type LogoImage = HTMLCanvasElement | ImageBitmap;

/** White version of a logo (keeps its shape and transparency). */
export function tintLogo(src: CanvasImageSource & { width: number; height: number }, tint: ProtectionSetting['logoTint']): LogoImage {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(src, 0, 0);
  if (tint === 'white') {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

let logoCache: { key: string; img: LogoImage } | null = null;

/** The current logo, fetched once per logo + colour and reused for a whole batch. */
export async function loadLogo(p: ProtectionSetting): Promise<LogoImage | null> {
  if (!logoActive(p)) return null;
  const key = `${p.logoHash}:${p.logoTint}`;
  if (logoCache?.key === key) return logoCache.img;
  const res = await fetch('/api/admin/watermark-logo', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Couldn’t load the logo (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const img = tintLogo(bmp, p.logoTint);
  bmp.close();
  logoCache = { key, img };
  return img;
}

/** Forget the cached logo (after uploading or removing one). */
export function clearLogoCache(): void {
  logoCache = null;
}

export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, p: ProtectionSetting, logo: LogoImage | null = null): void {
  const text = p.text.trim();
  const mark = logoActive(p) ? logo : null;
  if (!text && !mark) return;
  const long = Math.max(w, h);
  const px = Math.max(12, Math.round(long * SIZE[p.size]));
  ctx.save();
  ctx.font = `600 ${px}px "Inter Variable", Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
  ctx.shadowColor = `rgba(0,0,0,${Math.min(0.6, p.opacity + 0.1)})`;
  ctx.shadowBlur = Math.max(2, px * 0.12);
  const tw = text ? ctx.measureText(text).width : 0;
  // Logo is about 1.6× the text size tall, never wider than 4× its height.
  const lh = mark ? px * 1.6 : 0;
  const lw = mark ? Math.min(lh * 4, (mark.width / mark.height) * lh) : 0;
  const lhFit = mark ? (lw / (mark.width / mark.height)) : 0;
  const gap = mark && text ? px * 0.5 : 0;
  const groupW = lw + gap + tw;
  const pad = px * 1.1;

  // Draws the logo + text group with its left edge at x, vertically centred on y.
  const group = (x: number, y: number) => {
    if (mark) {
      ctx.globalAlpha = Math.min(1, p.opacity + 0.15);
      ctx.drawImage(mark, x, y - lhFit / 2, lw, lhFit);
      ctx.globalAlpha = 1;
    }
    if (text) {
      ctx.textAlign = 'left';
      ctx.fillText(text, x + lw + gap, y);
    }
  };

  if (p.position === 'tiled') {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 7);
    const stepX = groupW + px * 4;
    const stepY = Math.max(px, lhFit) * 3.4 + px;
    const reach = Math.hypot(w, h);
    for (let y = -reach; y < reach; y += stepY) {
      const offset = (Math.round(y / stepY) % 2) * (stepX / 2);
      for (let x = -reach; x < reach; x += stepX) group(x + offset - groupW / 2, y);
    }
  } else if (p.position === 'center') {
    group(w / 2 - groupW / 2, h / 2);
  } else {
    const y = h - pad - Math.max(0, (lhFit - px) / 2);
    group(p.position === 'br' ? w - pad - groupW : pad, y);
  }
  ctx.restore();
}

async function fontsReady(): Promise<void> {
  try {
    await document.fonts.load('600 40px "Inter Variable"');
  } catch {
    /* fall back to system font */
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Watermarked copy of an image blob. */
export async function renderWatermarked(src: Blob, p: ProtectionSetting): Promise<Blob> {
  await fontsReady();
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, WM_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  drawWatermark(ctx, w, h, p, await loadLogo(p));
  const webp = await toBlob(canvas, 'image/webp', 0.9);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.9);
  if (!jpeg) throw new Error('Could not encode the image');
  return jpeg;
}

async function uploadCopy(id: string, blob: Blob, sig: string): Promise<void> {
  const res = await fetch(`/api/admin/media/${id}/watermark`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': blob.type, 'X-Sx-Admin': '1', 'X-Sx-Wm-Sig': sig },
    body: blob,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Upload failed (${res.status})`);
  }
}

/** Watermark one stored photo (fetches its private original). */
export async function watermarkStored(id: string, p: ProtectionSetting, sig: string): Promise<void> {
  const res = await fetch(`/api/admin/media/${id}/original`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Couldn’t read the original (${res.status})`);
  const blob = await renderWatermarked(await res.blob(), p);
  await uploadCopy(id, blob, sig);
}

/** Right after an upload: watermark from the local file, if the watermark is on. */
export async function watermarkAfterUpload(id: string, file: Blob, mime: string): Promise<void> {
  if (!watermarkable(mime)) return;
  const [p, status] = await Promise.all([
    fetch('/api/admin/settings/protection', { credentials: 'same-origin' }).then((r) => r.json() as Promise<{ value: ProtectionSetting }>),
    fetch('/api/admin/media/watermark', { credentials: 'same-origin' }).then((r) => r.json() as Promise<{ sig: string }>),
  ]);
  if (!p.value.watermark) return;
  await uploadCopy(id, await renderWatermarked(file, p.value), status.sig);
}
