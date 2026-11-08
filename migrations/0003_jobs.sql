-- Background jobs without Cloudflare cron triggers (the free plan allows only 5 per account).
-- Visits to the site start due jobs in the background; each job is claimed atomically
-- here, so it runs once per interval however many requests arrive together.
CREATE TABLE IF NOT EXISTS jobs (
  name        text PRIMARY KEY,
  last_run_at timestamptz NOT NULL DEFAULT 'epoch'
);
