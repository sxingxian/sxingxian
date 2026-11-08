// Applies migrations/*.sql to Neon in order, once each.
// Usage: DATABASE_URL=postgresql://... npm run db:migrate
// The connection string is read from the environment only; never hard-code it.
import { neon } from '@neondatabase/serverless';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Export it in your shell (do not commit it).');
  process.exit(1);
}

const sql = neon(url);
await sql.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const done = new Set((await sql.query('SELECT name FROM _migrations')).map((r) => r.name));

const dir = new URL('../migrations/', import.meta.url).pathname;
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (done.has(file)) continue;
  const text = await readFile(join(dir, file), 'utf8');
  // Split on semicolons at line ends; our migrations contain no function bodies.
  const statements = text
    .split(/;\s*$/m)
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter(Boolean);
  console.log(`Applying ${file} (${statements.length} statements)`);
  await sql.transaction(statements.map((s) => sql.query(s)).concat([sql.query('INSERT INTO _migrations (name) VALUES ($1)', [file])]));
}
console.log('Migrations up to date.');
