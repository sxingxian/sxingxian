// Shared by the admin (which draws the watermark) and the server (which decides whether a stored
// watermarked copy matches the current settings).
import type { ProtectionSetting } from './types';

export const WM_MAX_EDGE = 2560; // public copies are capped at this many pixels on the long side

/** True when the logo is part of the watermark (switched on and uploaded). */
export function logoActive(p: Pick<ProtectionSetting, 'logo' | 'logoHash'>): boolean {
  return !!p.logo && !!p.logoHash;
}

/** Short fingerprint of the settings that change how a watermark looks. Text-only watermarks keep
 *  their original fingerprint, so adding logo support doesn't make existing copies stale. */
export async function watermarkSig(p: Pick<ProtectionSetting, 'text' | 'position' | 'size' | 'opacity'> & Partial<Pick<ProtectionSetting, 'logo' | 'logoTint' | 'logoHash'>>): Promise<string> {
  const base = { v: 1, t: p.text.trim(), p: p.position, s: p.size, o: Math.round(p.opacity * 100), e: WM_MAX_EDGE };
  const withLogo = p.logo && p.logoHash ? { ...base, l: p.logoHash, lt: p.logoTint ?? 'original' } : base;
  const canon = JSON.stringify(withLogo);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Photos that get a watermark: still images (animated GIFs would lose their animation). */
export function watermarkable(mime: string): boolean {
  return /^image\/(jpeg|png|webp|avif)$/.test(mime);
}

/** A watermark needs text, a logo, or both. */
export function watermarkHasContent(p: Pick<ProtectionSetting, 'text' | 'logo' | 'logoHash'>): boolean {
  return p.text.trim() !== '' || logoActive(p);
}
