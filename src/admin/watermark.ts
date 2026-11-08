// Draws watermarked public copies in the browser (canvas) and uploads them.
// Copies are capped at WM_MAX_EDGE px and saved as WebP (JPEG where WebP encoding isn't available).
import type { ProtectionSetting } from '../lib/shared/types';
import { WM_MAX_EDGE, watermarkable } from '../lib/shared/watermark';

const SIZE = { s: 0.022, m: 0.032, l: 0.046 } as const;

export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, p: ProtectionSetting): void {
  const text = p.text.trim();
  if (!text) return;
  const long = Math.max(w, h);
  const px = Math.max(12, Math.round(long * SIZE[p.size]));
  ctx.save();
  ctx.font = `600 ${px}px "Inter Variable", Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
  ctx.shadowColor = `rgba(0,0,0,${Math.min(0.6, p.opacity + 0.1)})`;
  ctx.shadowBlur = Math.max(2, px * 0.12);
  const tw = ctx.measureText(text).width;
  const pad = px * 1.1;
  if (p.position === 'tiled') {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 7);
    const stepX = tw + px * 4;
    const stepY = px * 4.2;
    const reach = Math.hypot(w, h);
    for (let y = -reach; y < reach; y += stepY) {
      const offset = (Math.round(y / stepY) % 2) * (stepX / 2);
      for (let x = -reach; x < reach; x += stepX) ctx.fillText(text, x + offset, y);
    }
  } else if (p.position === 'center') {
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h / 2);
  } else {
    ctx.textAlign = p.position === 'br' ? 'right' : 'left';
    ctx.fillText(text, p.position === 'br' ? w - pad : pad, h - pad);
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
  drawWatermark(ctx, w, h, p);
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
