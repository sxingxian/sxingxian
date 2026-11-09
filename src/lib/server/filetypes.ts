// SERVER-ONLY. Decide what an uploaded document really is from its bytes, never from the browser's
// declared type. A file is accepted only if its contents match the extension it was given and that
// extension is on the allow-list (lib/shared/files.ts). HTML, SVG, scripts and archives are never accepted.
import { DOC_TYPES, extOf } from '../shared/files';

export type SniffResult = { ok: true; ext: string; mime: string } | { ok: false; reason: string };

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  return sig.every((v, i) => b[at + i] === v);
}

/** Latin-1 view of a slice, for finding ASCII markers like file names inside a zip. */
function ascii(b: Uint8Array, from: number, to: number): string {
  let s = '';
  const end = Math.min(b.length, to);
  for (let i = Math.max(0, from); i < end; i += 0x8000) s += String.fromCharCode(...b.subarray(i, Math.min(end, i + 0x8000)));
  return s;
}

/** Zip entry names live in the local headers (start) and the central directory (end). */
function zipNames(b: Uint8Array): string {
  return ascii(b, 0, 256 * 1024) + '\n' + ascii(b, b.length - 256 * 1024, b.length);
}

function isUtf8Text(b: Uint8Array): boolean {
  if (b.includes(0)) return false; // binary
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

export function sniffDocument(bytes: Uint8Array, fileName: string): SniffResult {
  const ext = extOf(fileName);
  const type = DOC_TYPES[ext];
  if (!type) return { ok: false, reason: 'This file type isn’t allowed' };
  const bad = (): SniffResult => ({ ok: false, reason: `This doesn’t look like a real .${ext} file` });
  const good: SniffResult = { ok: true, ext, mime: type.mime };

  switch (ext) {
    case 'pdf': {
      // The header must appear in the first 1 KB (the PDF spec allows a little junk before it).
      return ascii(bytes, 0, 1024).includes('%PDF-') ? good : bad();
    }
    case 'docx':
    case 'xlsx':
    case 'pptx': {
      if (!startsWith(bytes, ZIP)) return bad();
      const names = zipNames(bytes);
      const part = ext === 'docx' ? 'word/' : ext === 'xlsx' ? 'xl/' : 'ppt/';
      if (!names.includes('[Content_Types].xml') || !names.includes(part)) return bad();
      // Macros belong in .docm/.xlsm/.pptm, which aren't allowed; refuse one hidden in a .docx.
      if (names.includes('vbaProject.bin')) return { ok: false, reason: 'Files with macros aren’t allowed' };
      return good;
    }
    case 'odt':
    case 'ods':
    case 'odp': {
      if (!startsWith(bytes, ZIP)) return bad();
      // ODF puts an uncompressed "mimetype" entry first, so its value sits right after the local header.
      const head = ascii(bytes, 30, 200);
      if (!head.startsWith('mimetype') || !head.slice(8).startsWith(type.mime)) return bad();
      if (zipNames(bytes).includes('Basic/')) return { ok: false, reason: 'Files with macros aren’t allowed' };
      return good;
    }
    case 'doc':
    case 'xls':
    case 'ppt':
      return startsWith(bytes, OLE) ? good : bad();
    case 'rtf':
      return ascii(bytes, 0, 5) === '{\\rtf' ? good : bad();
    case 'txt':
    case 'md':
    case 'csv':
      return isUtf8Text(bytes) ? good : { ok: false, reason: 'Text files must be UTF-8 text' };
    case 'ics': {
      if (!isUtf8Text(bytes)) return { ok: false, reason: 'Calendar files must be UTF-8 text' };
      const text = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart();
      return text.toUpperCase().startsWith('BEGIN:VCALENDAR') ? good : bad();
    }
    default:
      return { ok: false, reason: 'This file type isn’t allowed' };
  }
}

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(kind: 'attachment' | 'inline', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
