// Copies the PDF.js runtime assets (character maps, standard fonts, WebAssembly decoders, colour
// profiles) from node_modules into public/pdfjs, where the PDF preview loads them from the site's own
// address. Runs before every build and dev server start; the folder is git-ignored.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'public', 'pdfjs');
if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed; run npm ci first.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
cpSync(join(src, 'LICENSE'), join(dest, 'LICENSE'));
console.log('✓ PDF.js assets copied to public/pdfjs');
