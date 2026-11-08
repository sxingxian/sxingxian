// Fails the build if anything secret-looking reaches files the browser can
// download (dist/client), or if secrets are committed to the repository.
// Run after `astro build`:  npm run security:scan
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const CLIENT = join(ROOT, 'dist', 'client');

// Names of server-only secrets/bindings. If any appears in a client file, a
// server module was bundled into the browser by mistake.
const SECRET_NAMES = [
  'DATABASE_URL', 'AUTH_SECRET', 'SETUP_TOKEN', 'WP_WEBHOOK_SECRET', 'NAS_S3_ACCESS_KEY_ID', 'NAS_S3_SECRET_ACCESS_KEY',
  'B2_S3_ACCESS_KEY_ID', 'B2_S3_SECRET_ACCESS_KEY', 'cloudflare:workers',
  '@neondatabase/serverless', 'aws4fetch', 'password_hash', 'totp_secret_enc', 'gen_salt', 'sxingxian/session/v1',
];

const PATTERNS = [
  ['Postgres connection string', /postgres(?:ql)?:\/\/[^\s'"`]+:[^\s'"`]+@/i],
  ['AWS-style access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['Cloudflare API token', /\b[A-Za-z0-9_-]{40}\b(?=.*cloudflare)/i],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Generic secret assignment', /(?:secret|password|api[_-]?key|token)\s*[:=]\s*['"][A-Za-z0-9/+_\-]{24,}['"]/i],
];

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const findings = [];

// 1) Browser-downloadable build output
try {
  const files = (await walk(CLIENT)).filter((f) => /\.(js|mjs|css|html|json|txt|xml|map)$/.test(f) || f.endsWith('_headers'));
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    const rel = relative(ROOT, f);
    if (f.endsWith('.map')) findings.push(`${rel}: source map is publicly downloadable`);
    for (const name of SECRET_NAMES) if (text.includes(name)) findings.push(`${rel}: contains server-only identifier "${name}"`);
    for (const [label, re] of PATTERNS) if (re.test(text)) findings.push(`${rel}: looks like a ${label}`);
  }
  console.log(`Scanned ${files.length} client files in dist/client`);
} catch {
  console.error('dist/client not found — run `npm run build` first.');
  process.exit(2);
}

// 2) Tracked repository files (what would be pushed to GitHub)
let tracked = [];
try {
  tracked = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch {
  /* not a git repo */
}
for (const f of tracked) {
  if (/(^|\/)(node_modules|dist)\//.test(f) || /\.(woff2?|png|jpe?g|gif|ico|lock)$/.test(f) || f === 'package-lock.json') continue;
  if (/^\.dev\.vars$|^\.env($|\.)/.test(f.split('/').pop()) && !f.endsWith('.example')) findings.push(`${f}: local secrets file is tracked by git`);
  let text;
  try {
    text = await readFile(join(ROOT, f), 'utf8');
  } catch {
    continue;
  }
  for (const [label, re] of PATTERNS) {
    if (f === 'scripts/scan-client-bundle.mjs' || f === 'scripts/test-security.mjs') continue;
    if (re.test(text)) findings.push(`${f}: looks like a ${label}`);
  }
}
console.log(`Scanned ${tracked.length} repository files`);

if (findings.length) {
  console.error(`\n✖ ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ No secrets or server-only code found in the client bundle or repository.');
