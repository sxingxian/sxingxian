// Shared by the admin (which draws the watermark) and the server (which decides whether a stored
// watermarked copy matches the current settings).
import type { ProtectionSetting } from './types';

export const WM_MAX_EDGE = 2560; // public copies are capped at this many pixels on the long side

/** Short fingerprint of the settings that change how a watermark looks. */
export async function watermarkSig(p: Pick<ProtectionSetting, 'text' | 'position' | 'size' | 'opacity'>): Promise<string> {
  const canon = JSON.stringify({ v: 1, t: p.text.trim(), p: p.position, s: p.size, o: Math.round(p.opacity * 100), e: WM_MAX_EDGE });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Photos that get a watermark: still images (animated GIFs would lose their animation). */
export function watermarkable(mime: string): boolean {
  return /^image\/(jpeg|png|webp|avif)$/.test(mime);
}
