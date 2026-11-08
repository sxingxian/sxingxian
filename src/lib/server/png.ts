// Minimal PNG checks for the watermark logo: signature, a well-formed IHDR, bounded dimensions.
// The admin already re-encodes the logo through a canvas; this is the server-side backstop.

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const LOGO_MAX_BYTES = 256 * 1024;
export const LOGO_MAX_EDGE = 1024;

export type PngCheck = { ok: true; width: number; height: number } | { ok: false; reason: string };

export function checkPng(b: Uint8Array, maxEdge = LOGO_MAX_EDGE, maxBytes = LOGO_MAX_BYTES): PngCheck {
  if (b.byteLength < 33) return { ok: false, reason: 'Not a PNG image' };
  if (b.byteLength > maxBytes) return { ok: false, reason: `Logo must be under ${Math.round(maxBytes / 1024)} KB` };
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return { ok: false, reason: 'Not a PNG image' };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // First chunk must be IHDR with a 13-byte body.
  if (dv.getUint32(8) !== 13 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return { ok: false, reason: 'Not a PNG image' };
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  if (width < 1 || height < 1 || width > maxEdge || height > maxEdge) return { ok: false, reason: `Logo must be at most ${maxEdge}×${maxEdge} px` };
  // Must end with an IEND chunk (no trailing data appended to the image).
  const tail = b.subarray(b.byteLength - 12);
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  for (let i = 0; i < 12; i++) if (tail[i] !== iend[i]) return { ok: false, reason: 'Not a complete PNG image' };
  return { ok: true, width, height };
}

export async function sha256Hex(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
