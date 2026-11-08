# Deploying sxingxian.com

The site runs on free tiers: **Neon** (Postgres) for the database and **Cloudflare Workers** for the site, the admin portal, media storage (R2) and the scheduled WordPress jobs. Allow 30–45 minutes the first time.

| Host | Serves | Where it runs |
| --- | --- | --- |
| `sxingxian.com` | Public site, plus the admin portal at `/admin` | Cloudflare Worker `sxingxian` |
| `hey.sxingxian.com` | WordPress journal (its own admin at `/admin`) | Your existing WordPress host, unchanged |

How changes reach production:

| What changed | How it goes live |
| --- | --- |
| Code (pages, admin, styles, Worker) | **Automatic.** The Worker is connected to Git, so every push to `main` builds and deploys. |
| Database (`migrations/*.sql`) | **Actions → Deploy Neon → Run workflow** (or automatically after CI, if you turn on `AUTO_DEPLOY_NEON`). |
| Secrets and settings | Cloudflare dashboard → `sxingxian` → Settings → Variables and secrets. They are kept across deploys. |

Do the steps in order: the database must exist before the Worker's first deploy, and the R2 bucket must exist or the deploy fails.

## 1. Neon project

1. console.neon.tech → **New project**. Name `sxingxian`, Postgres 17, region **AWS Asia Pacific (Singapore)** (closest to you and to Cloudflare's SIN edge).
2. Keep the default database `neondb` and role `neondb_owner`. (If you choose other names, set the GitHub variables `NEON_DATABASE_NAME` and `NEON_ROLE_NAME` in section 7.)
3. **Connect** → tick **Connection pooling** → copy the connection string. It starts with `postgresql://`, and its host name contains `-pooler`. Keep it somewhere private for step 4; never commit it.
4. **Account settings → API keys → Create** a key for GitHub. A **project-scoped** key for `sxingxian` is enough. Copy it.
5. **Project settings → General** → copy the **Project ID** (e.g. `cool-river-12345678`).

The tables are created in section 7 by the **Deploy Neon** workflow, so there is nothing to run here.

## 2. Cloudflare Access (protects `/admin`)

Zero Trust → **Access → Applications → Add an application → Self-hosted**:

- **Application name:** `sxingxian admin`
- **Public hostnames:** `sxingxian.com` with the paths **`admin`**, **`admin/*`** and **`api/admin/*`** (three entries).
  Do **not** add `api/hooks/*`: WordPress must be able to reach the webhook. It is protected by its own signature.
- **Policy:** Action *Allow* → Include → *Emails* → your email address.
- Save, then copy:
  - the **Application Audience (AUD) tag** (Application → Overview), used as `ACCESS_AUD`;
  - your **team domain**, e.g. `yourteam.cloudflareaccess.com` (Zero Trust → Settings), used as `ACCESS_TEAM_DOMAIN`.

The Worker checks the Access token on every admin request (signature, issuer, audience, expiry, and your email), so the admin stays closed even if the Access application is misconfigured.

## 3. R2 bucket (media)

Cloudflare → **R2 Object Storage → Create bucket** → name **`sxingxian-media`**, location *Asia-Pacific*. Leave public access **off**: media is served through the Worker at `/media/:id`.

## 4. Cloudflare Worker (connected to Git)

Make sure `sxingxian.com` is a zone in the same Cloudflare account. If the zone already has an `A`, `AAAA` or `CNAME` record for the bare `sxingxian.com`, delete it first; the Worker claims that hostname as a custom domain on its first deploy. Leave the `hey` record for WordPress alone.

Cloudflare → **Workers & Pages → Create → Import a repository** → GitHub → `sxingxian/sxingxian`:

- **Project name:** `sxingxian`. It must match `name` in `wrangler.jsonc`.
- **Root directory:** `/`
- **Build command:** `npm ci && npm run build`
- **Deploy command:** `npx wrangler deploy`
- **Non-production branch deploy command:** `npx wrangler versions upload`
  (uploads a version for other branches without sending it live; you can also turn off non-production builds under Settings → Build → Branch control).
- **Build variables:** `NODE_VERSION` = `22`

The first build deploys straight away. Everything else the Worker needs is in `wrangler.jsonc`: the custom domain, the R2 binding, the webhook rate limit and the cron triggers (health check every 5 minutes, nightly reconcile at 03:00 SGT). The Worker answers only on `sxingxian.com`; the `workers.dev` address and per-version preview addresses are off.

### Variables and secrets

`sxingxian` → **Settings → Variables and secrets → Add**. Saving creates a new deployment automatically.

| Name | Type | Value |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Neon pooled connection string (section 1, step 3) |
| `ACCESS_AUD` | Secret | AUD tag (section 2) |
| `WP_WEBHOOK_SECRET` | Secret | A new random value: `openssl rand -hex 32`, or any 64-character password generator. You also paste it into WordPress (section 5). |
| `ACCESS_TEAM_DOMAIN` | Text | `yourteam.cloudflareaccess.com` |
| `ADMIN_EMAILS` | Text | Your email. Comma-separate more than one. |

`SITE_URL` and `WP_BASE_URL` are already set in `wrangler.jsonc`. `keep_vars` is on, so deploys from Git never wipe what you add here. Secrets are encrypted by Cloudflare, never in the repository, and never sent to the browser (the CI secret scan checks every build).

From a computer, the same can be done with `npx wrangler secret put DATABASE_URL` and so on.

Optional media hosts (both are S3-compatible; hosts without credentials are greyed out in the upload dialog):

| Name | Type | For |
| --- | --- | --- |
| `NAS_S3_ENDPOINT`, `NAS_S3_BUCKET`, `NAS_S3_REGION` | Text | NAS running MinIO or Garage, exposed through **Cloudflare Tunnel** at an `https://` hostname (no router ports opened) |
| `NAS_S3_ACCESS_KEY_ID`, `NAS_S3_SECRET_ACCESS_KEY` | Secret | NAS credentials |
| `B2_S3_ENDPOINT`, `B2_S3_BUCKET`, `B2_S3_REGION` | Text | Backblaze B2 |
| `B2_S3_ACCESS_KEY_ID`, `B2_S3_SECRET_ACCESS_KEY` | Secret | B2 application key |

Video uploads always go to R2: Cloudflare's CDN terms restrict serving video hosted elsewhere. Use YouTube or Vimeo embeds for long films.

### Optional: `www`

To send `www.sxingxian.com` to the bare domain: add a proxied `CNAME www → sxingxian.com`, then Rules → **Redirect Rules** → *Redirect from WWW to root* template.

## 5. WordPress (`hey.sxingxian.com`)

1. Upload the folder `wordpress-plugin/sxingxian-sync/` to `wp-content/plugins/` and activate **sxingxian sync** at `https://hey.sxingxian.com/admin`.
2. Add to `wp-config.php`, above the "That's all, stop editing!" line, with the **same** value as `WP_WEBHOOK_SECRET`:
   ```php
   define( 'SXINGXIAN_WEBHOOK_URL', 'https://sxingxian.com/api/hooks/wordpress' );
   define( 'SXINGXIAN_WEBHOOK_SECRET', 'the-same-64-character-secret' );
   ```
3. If `hey.sxingxian.com` is proxied by Cloudflare with Bot Fight Mode, Super Bot Fight Mode or a WAF challenge, add a WAF **skip** rule for the path `/wp-json/` so the Worker's sync isn't challenged.

## 6. GitHub (database deploys)

Repository → **Settings → Environments → New environment** → `production`. Optionally add yourself under *Required reviewers*, so every database change waits for your tap on Approve.

Repository → **Settings → Secrets and variables → Actions** (in a phone browser at github.com; the GitHub app can't edit secrets):

| Tab | Name | Value |
| --- | --- | --- |
| Secrets | `NEON_API_KEY` | The API key from section 1, step 4 |
| Variables | `NEON_PROJECT_ID` | The Project ID from section 1, step 5 |
| Variables | `AUTO_DEPLOY_NEON` | Optional. `true` to deploy migrations automatically after CI passes on `main`. |
| Variables | `NEON_DATABASE_NAME`, `NEON_ROLE_NAME` | Optional. Only if you didn't keep `neondb` / `neondb_owner`. |

No connection string or Cloudflare token is stored in GitHub. The Deploy Neon workflow asks the Neon API for the connection string with the API key at run time and masks it in the logs. (If you'd rather store it, add a `DATABASE_URL` secret to the `production` environment and it is used instead.)

Instead of adding the two Neon values by hand, you can use Neon console → **Integrations → GitHub**, which creates `NEON_API_KEY` and `NEON_PROJECT_ID` for you.

## 7. Create the tables

GitHub app → the repository → **Actions** → **Deploy Neon** → **Run workflow**:

1. Tick **dry run** first. The run should list `0001_init.sql` as pending. This confirms GitHub can reach Neon.
2. Run it again without dry run. It takes a backup branch, applies the migration, and the summary shows the result.

Then open `https://sxingxian.com`. The journal is empty until you write a post or WordPress syncs.

## 8. After the first deploy

- [ ] `https://sxingxian.com` loads; `https://sxingxian.com/rss.xml` is valid.
- [ ] `https://sxingxian.com/admin` asks you to sign in with Cloudflare Access, then opens the admin. In a private window with another email, it is refused.
- [ ] Admin → **WordPress** → **Sync now**. Recent WordPress posts appear in the journal. Map WordPress categories to topics, and choose whether new WordPress posts show automatically.
- [ ] Publish or edit a test post on `hey.sxingxian.com`; it updates on `sxingxian.com` within a few seconds (webhook). The admin's WordPress page shows the sync log.
- [ ] Admin → **Settings**: site title, sections on/off (Work, Photos, Film, CV, About), featured post (pinned or latest), footer text and links.
- [ ] Upload an image to R2 in the media library, insert it in a post, publish, and check it shows on the public page.
- [ ] Run `https://securityheaders.com` and `https://observatory.mozilla.org` against `https://sxingxian.com`. You should get an A or better.
- [ ] Cloudflare → `sxingxian` → **Logs**: the cron runs every 5 minutes without errors.

## Day to day

**Writing:** sign in at `sxingxian.com/admin`. Nothing to deploy.

**Code changes:** merge to `main`. CI runs the checks; Cloudflare builds and deploys the Worker by itself. Build progress and logs are in Cloudflare → `sxingxian` → **Deployments**.

**Database changes**, from a phone:

1. Add a new file `migrations/0002_<what>.sql`. Never edit an applied one; the migration script refuses files whose checksum changed.
2. Open a pull request. **Neon · test migrations on a branch** copies production to a throwaway branch, applies the migrations twice (the second run must change nothing), comments the schema diff, and deletes the branch when the PR closes.
3. Merge. Wait for CI to pass.
4. **Actions → Deploy Neon → Run workflow** (or let `AUTO_DEPLOY_NEON` do it). It refuses a commit whose CI didn't pass, backs up production to `backup/pre-migrate-<run>` (kept 7 days), then applies.

Because code goes live on push while migrations run a few minutes later, write migrations **expand then contract**: add columns or tables in one release (code that doesn't need them yet keeps working), use them in the next, and drop old ones only after nothing reads them.

## Rolling back

- **Code:** Cloudflare → `sxingxian` → **Deployments** → pick the previous version → **Rollback**. Or revert the commit on `main`.
- **Database:** Neon console → **Branches** → `main` → **Restore**, and restore from the branch `backup/pre-migrate-<run>` (or connect to the backup branch and copy back only what you need). Backups expire after 7 days. Roll the code back first if it already uses the new schema.

## Release safety

- GitHub Actions are pinned to exact commits (with the version in a comment). Dependabot proposes updates (npm weekly, Actions monthly).
- CI installs only the versions in `package-lock.json`, runs `npm audit`, the type check, the build, the security lint and tests, the secret scan of the browser bundle, and a `wrangler deploy --dry-run` of the exact Worker bundle.
- Automatic Neon deploys (`AUTO_DEPLOY_NEON`) run only after CI passed on a push to this repository's `main`, never for a pull request's run or a fork.
- Every production migration is preceded by a Neon backup branch and runs in a transaction under an advisory lock, so two runs can't overlap and a failed file changes nothing.
- The Worker serves only `sxingxian.com` (`workers_dev` and `preview_urls` are off), and `keep_vars` stops deploys from clearing dashboard settings.
- Secrets live only in Cloudflare (Worker runtime) and GitHub (Neon API key). None are in the repository, the build output or the browser.

## Local development

```bash
cp .dev.vars.example .dev.vars   # DATABASE_URL = a Neon *dev branch*, never production
npm ci
DATABASE_URL='…dev branch…' npm run db:migrate
npm run dev                      # http://localhost:4321, /admin works on localhost only
```

`npm run db:status` shows applied and pending migrations for whatever `DATABASE_URL` points at.
