// SERVER-ONLY. Background maintenance that needs no cron trigger.
//
// Cloudflare's free plan allows 5 cron triggers per ACCOUNT, shared by every Worker.
// So instead of relying on them, every site visit (and admin request) checks, at most
// once a minute per isolate, whether a job is due, and runs it after the response has
// been sent (waitUntil). Each job is claimed with one atomic UPDATE, so it runs once
// per interval no matter how many requests arrive together.
//
// If a cron slot is free, add  "*/5 * * * *"  to wrangler.jsonc → triggers.crons; the
// scheduled handler calls the same runMaintenance(), and the claims stop double runs.
import { sql } from './db';
import { healthCheck, log, reconcile, syncIncremental } from './wordpress';
import { purgeAuthData } from './users';

// Seconds. Slightly under the nominal interval so a 5-minute cron never just misses.
const EVERY = {
  'wp-health': 290, // WordPress up/down check (2 fails hide WordPress posts, 2 OKs show them)
  'wp-pull': 890, // pick up WordPress changes a webhook missed
  'wp-reconcile': 86_000, // daily: remove posts deleted/trashed/private on WordPress
  'auth-purge': 86_000, // daily: expired sessions, sign-in history over 180 days
} as const;

type Job = keyof typeof EVERY;

/** Atomically claims a job if it is due. True means this caller must run it. */
async function claim(name: Job): Promise<boolean> {
  const rows = await sql()`
    INSERT INTO jobs (name, last_run_at) VALUES (${name}, now())
    ON CONFLICT (name) DO UPDATE SET last_run_at = now()
    WHERE jobs.last_run_at < now() - make_interval(secs => ${EVERY[name]})
    RETURNING name`;
  return rows.length > 0;
}

async function wordpressUp(): Promise<boolean> {
  const rows = await sql()`SELECT status FROM sources WHERE id = 'wordpress'`;
  return rows[0]?.status !== 'down';
}

async function attempt(name: Job, fn: () => Promise<unknown>): Promise<void> {
  try {
    if (await claim(name)) await fn();
  } catch (e) {
    await log(`Job ${name}`, `error: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`, false).catch(() => {});
  }
}

/** Runs every job that is due. Safe to call from many places at once. */
export async function runMaintenance(): Promise<void> {
  await attempt('wp-health', () => healthCheck());
  await attempt('wp-pull', async () => {
    if (await wordpressUp()) await syncIncremental();
  });
  await attempt('wp-reconcile', async () => {
    if (await wordpressUp()) await reconcile();
  });
  await attempt('auth-purge', () => purgeAuthData());
}

let lastLook = 0;

/** Call on any request. Looks for due jobs at most once a minute per isolate, after the response. */
export function maintenanceOnRequest(waitUntil: ((p: Promise<unknown>) => void) | undefined): void {
  if (!waitUntil) return;
  const now = Date.now();
  if (now - lastLook < 60_000) return;
  lastLook = now;
  waitUntil(runMaintenance().catch(() => {}));
}
