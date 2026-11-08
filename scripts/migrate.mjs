// Applies migrations/*.sql to Neon in filename order, once each, inside a
// transaction per file. Used locally and by GitHub Actions.
//
//   DATABASE_URL=… node scripts/migrate.mjs            apply pending migrations
//   DATABASE_URL=… node scripts/migrate.mjs --status   list applied / pending, change nothing
//
// Safety:
//  • The connection string comes from the environment only and is never printed.
//  • Each file runs in one transaction with an advisory lock, so a failed file
//    leaves no partial changes and two concurrent runs cannot both apply it.
//  • A SHA-256 checksum is stored per file; editing an already-applied migration
//    fails the run (write a new migration instead).
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_KEY = 727274; // arbitrary constant shared by every run
const statusOnly = process.argv.includes('--status');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Export it in your shell or CI secret (never commit it).');
  process.exit(1);
}
let host = 'unknown host';
try {
  host = new URL(url).hostname.replace(/^([^.]+)\..*$/, '$1…'); // endpoint id only, no credentials
} catch {
  console.error('DATABASE_URL is not a valid URL.');
  process.exit(1);
}

const sql = neon(url);

await sql.query(`CREATE TABLE IF NOT EXISTS _migrations (
  name text PRIMARY KEY,
  checksum text,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);
await sql.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text');

const applied = new Map((await sql.query('SELECT name, checksum FROM _migrations')).map((r) => [r.name, r.checksum]));

const dir = new URL('../migrations/', import.meta.url).pathname;
const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();

const pending = [];
let drift = false;
for (const file of files) {
  const text = await readFile(join(dir, file), 'utf8');
  const checksum = createHash('sha256').update(text).digest('hex');
  if (applied.has(file)) {
    const stored = applied.get(file);
    if (stored && stored !== checksum) {
      console.error(`✖ ${file} was changed after it was applied. Revert the edit and add a new migration instead.`);
      drift = true;
    }
    if (!stored) await sql.query('UPDATE _migrations SET checksum = $1 WHERE name = $2', [checksum, file]); // backfill
  } else {
    pending.push({ file, text, checksum });
  }
}
if (drift) process.exit(1);

console.log(`Database ${host}: ${applied.size} applied, ${pending.length} pending.`);
if (statusOnly) {
  for (const p of pending) console.log(`  pending  ${p.file}`);
  process.exit(0);
}

for (const { file, text, checksum } of pending) {
  // Our migrations contain no function bodies, so splitting on line-ending semicolons is safe.
  const statements = text
    .split(/;\s*$/m)
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter(Boolean);
  console.log(`Applying ${file} (${statements.length} statements)…`);
  await sql.transaction([
    sql.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]),
    ...statements.map((s) => sql.query(s)),
    // PRIMARY KEY makes a concurrent duplicate run fail and roll back.
    sql.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [file, checksum]),
  ]);
}
console.log(pending.length ? `✓ Applied ${pending.length} migration(s).` : '✓ Already up to date.');
