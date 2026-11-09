// Documents that can be uploaded and attached to stories and work (besides photos and video).
// The server decides a file's type from its contents (lib/server/filetypes.ts); this list is shared
// so the admin and the public pages label files the same way.

export interface DocType {
  mime: string;
  label: string;
  /** Short badge text and colour for file cards. */
  badge: string;
  color: string;
}

export const DOC_TYPES: Record<string, DocType> = {
  pdf: { mime: 'application/pdf', label: 'PDF', badge: 'PDF', color: '#B4412F' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document', badge: 'DOCX', color: '#2B579A' },
  doc: { mime: 'application/msword', label: 'Word document', badge: 'DOC', color: '#2B579A' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel spreadsheet', badge: 'XLSX', color: '#217346' },
  xls: { mime: 'application/vnd.ms-excel', label: 'Excel spreadsheet', badge: 'XLS', color: '#217346' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint', badge: 'PPTX', color: '#C4502F' },
  ppt: { mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint', badge: 'PPT', color: '#C4502F' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', label: 'OpenDocument text', badge: 'ODT', color: '#2B579A' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', label: 'OpenDocument spreadsheet', badge: 'ODS', color: '#217346' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', label: 'OpenDocument presentation', badge: 'ODP', color: '#C4502F' },
  rtf: { mime: 'application/rtf', label: 'Rich text', badge: 'RTF', color: '#55534E' },
  txt: { mime: 'text/plain', label: 'Text', badge: 'TXT', color: '#55534E' },
  md: { mime: 'text/markdown', label: 'Markdown', badge: 'MD', color: '#3D3B37' },
  csv: { mime: 'text/csv', label: 'CSV', badge: 'CSV', color: '#217346' },
  ics: { mime: 'text/calendar', label: 'Calendar', badge: 'ICS', color: '#1E5B4F' },
};

export const DOC_MIMES = new Set(Object.values(DOC_TYPES).map((t) => t.mime));
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

/** For <input type="file" accept>. */
export const DOC_ACCEPT = Object.keys(DOC_TYPES).map((e) => `.${e}`).join(',');
export const DOC_LIST = 'PDF · Word · Excel · PowerPoint · OpenDocument · RTF · TXT · Markdown · CSV · Calendar (.ics)';

export function isDocMime(mime: string): boolean {
  return DOC_MIMES.has(mime);
}

export function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Type info for a stored file, by MIME (authoritative), falling back to the name's extension. */
export function docTypeFor(mime: string, name = ''): DocType {
  const byMime = Object.values(DOC_TYPES).find((t) => t.mime === mime);
  return byMime ?? DOC_TYPES[extOf(name)] ?? { mime, label: 'File', badge: 'FILE', color: '#55534E' };
}

export function formatBytes(raw: number | string): string {
  const n = Number(raw); // Postgres bigint arrives as a string
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Clean a file name for storage and the Content-Disposition header; the extension is forced to the real type. */
export function cleanFileName(raw: string, ext: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"*:<>?|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return `${base || 'file'}.${ext}`;
}
