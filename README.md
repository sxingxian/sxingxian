# sxingxian.com

A journal-first personal site with a Notion-style CMS. Posts you write here and posts from the WordPress journal at **hey.sxingxian.com** appear in one feed. Work, photos, film, a CV page and an About page sit alongside, and each can be switched on or off.

- **Public site:** `https://sxingxian.com`
- **Admin:** `https://sxingxian.com/admin` (protected by Cloudflare Access)
- **WordPress journal:** `https://hey.sxingxian.com` (its own admin: `https://hey.sxingxian.com/admin`)

## Stack

| Part | Choice |
|---|---|
| Framework | Astro 7, server-rendered on **Cloudflare Workers** |
| Admin | React app at `/admin`, editor built on **Tiptap 3**: slash menu, drag handles, resizable 2/3-column blocks |
| Database | **Neon** Postgres over HTTP (`@neondatabase/serverless`), parameterised SQL only |
| Media | Choose per upload: **Cloudflare R2**, your **NAS** (S3-compatible, via Cloudflare Tunnel) or **Backblaze B2**; YouTube/Vimeo for long video |
| Auth | **Cloudflare Access** (Zero Trust) + server-side JWT verification on every admin request |
| Jobs | Cron Triggers on the same Worker: WordPress health check, sync, nightly reconcile |

Public pages ship **no JavaScript**. Only `/admin` loads the editor bundle.

## Features

- **Journal home:** a featured post, latest posts (native + WordPress) with topic filters, RSS, and sidebar cards for Work, Photos and Film.
- **Featured post:** pin a post in the admin (Settings → Sections & featured post, or the "Feature on home page" switch in the editor), or leave it on *Always show the latest post*.
- **Section switches:** Work, Photos, Film, CV and About can each be turned off. They leave the menu and home page, their pages return 404, and their content is kept.
- **Notion-style editor:**
  - **Blocks:** text, headings, lists, quote, callout, code, divider.
  - **Media:** images (with alt text, caption and width) and YouTube/Vimeo embeds.
  - **Layout:** 2- or 3-column blocks with draggable dividers, presets, gap, phone stacking and dividers.
  - **Editing:** a formatting bubble and drag handles.
- **CV page** (`/cv`): built from column blocks, printable to PDF from the browser (print stylesheet included).
- **Editable footer:** about text, up to 3 link columns, bottom line with `{year}`. Links are allow-listed.
- **WordPress sync** (see below), with automatic hiding when WordPress is down.
- **RSS** at `/rss.xml`. There is no newsletter or email collection.

## Project layout

```
src/
  worker.ts                 Worker entry: Astro fetch handler + cron handler
  middleware.ts             Access JWT check, CSRF guard, CSP nonce, security headers
  pages/                    Public pages, /admin shell, /api/admin/*, /api/hooks/wordpress, /media/:id, /rss.xml
  admin/                    React admin app (views, editor, media picker)
  lib/server/               SERVER-ONLY: db, repo, auth, storage, wordpress, renderer
  lib/shared/               Types, Zod schemas, URL helpers shared with the admin
migrations/                 SQL migrations for Neon
wordpress-plugin/           One-file plugin for hey.sxingxian.com
scripts/                    migrate, security tests, client-bundle secret scan
```

## Setup

### 1. Neon

1. Create a Neon project and copy the **pooled** connection string.
2. Run the migrations, either from GitHub Actions (see **GitHub Actions** below; recommended) or from your machine. Export the variable in your shell; don't put it in a file that git tracks.
   ```bash
   export DATABASE_URL='…'
   npm ci
   npm run db:migrate
   ```

### 2. Cloudflare

1. Make sure `sxingxian.com` is a zone in your Cloudflare account.
2. Create the media bucket: `npx wrangler r2 bucket create sxingxian-media`
3. **Cloudflare Access.** In Zero Trust → Access → Applications, add a *Self-hosted* application:
   - **Domain:** `sxingxian.com`, paths **`/admin`**, **`/admin/*`** and **`/api/admin/*`**. Do *not* include `/api/hooks/*`: WordPress must be able to reach it.
   - **Policy:** Allow → Emails → your email address.
   - **Copy** the application's **AUD tag** and your **team domain** (e.g. `yourteam.cloudflareaccess.com`).
4. Edit `wrangler.jsonc` → `vars` (these values are not secret):
   - `ACCESS_TEAM_DOMAIN` = your team domain
   - `ADMIN_EMAILS` = your email (comma-separate multiple)
5. Set the secrets. They are stored encrypted in Cloudflare, never in the repo, and never sent to the browser:
   ```bash
   npx wrangler secret put DATABASE_URL        # Neon pooled connection string
   npx wrangler secret put ACCESS_AUD          # AUD tag from step 3
   npx wrangler secret put WP_WEBHOOK_SECRET   # generate: openssl rand -hex 32
   ```
6. Deploy: `npm run deploy`

### 3. WordPress (hey.sxingxian.com)

1. Upload `wordpress-plugin/sxingxian-sync/` to `wp-content/plugins/` and activate it at `https://hey.sxingxian.com/admin`.
2. Add these lines to `wp-config.php`. Use the **same** secret as `WP_WEBHOOK_SECRET`:
   ```php
   define( 'SXINGXIAN_WEBHOOK_URL', 'https://sxingxian.com/api/hooks/wordpress' );
   define( 'SXINGXIAN_WEBHOOK_SECRET', 'the-64-character-hex-secret' );
   ```
3. In sxingxian.com/admin → WordPress, press **Sync now**. Choose whether new WordPress posts appear automatically, and map WordPress categories to journal topics.
4. If hey.sxingxian.com is behind Cloudflare with Bot Fight Mode or a WAF challenge, allow `/wp-json/*` for requests from your own Worker, or the sync will be blocked.

#### How the sync works

| Path | When | What |
|---|---|---|
| Webhook | On publish, edit, unpublish or delete | The plugin sends only `{post_id, action}`, signed with HMAC-SHA256 and a timestamp (rejected after 5 min). The site then **fetches that post from the WordPress REST API itself**, so forged or tampered payloads can't inject content. |
| Incremental pull | Every 15 min | `GET /wp-json/wp/v2/posts?modified_after=…` catches missed webhooks. |
| Reconcile | Nightly, 03:00 SGT | Compares every published ID and marks deleted, trashed or private posts as removed. |
| Health check | Every 5 min | `GET /wp-json/` (5 s timeout). **2 failures in a row hide all WordPress posts** (feed, topic filters, RSS); **2 successes** show them again. |

Only the title, excerpt, featured image and link are copied. Cards link to WordPress, which stays the canonical page.

### 4. Optional: NAS and Backblaze B2

Both use the S3 API, so the NAS needs an S3-compatible service (e.g. MinIO or Garage). Expose it through **Cloudflare Tunnel** at an `https://` hostname; no router ports are opened. Then:

```bash
# wrangler.jsonc vars: NAS_S3_ENDPOINT, NAS_S3_BUCKET (and B2_S3_ENDPOINT, B2_S3_BUCKET)
npx wrangler secret put NAS_S3_ACCESS_KEY_ID
npx wrangler secret put NAS_S3_SECRET_ACCESS_KEY
npx wrangler secret put B2_S3_ACCESS_KEY_ID
npx wrangler secret put B2_S3_SECRET_ACCESS_KEY
```

Hosts without credentials appear greyed out in the upload dialog.

**Video is R2-only.** Cloudflare's CDN terms restrict serving video and large files that are hosted outside Cloudflare. Use R2 for short clips and YouTube or Vimeo for long ones.

## GitHub Actions (Neon + Cloudflare)

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`ci.yml`) | Every push and PR | `npm audit` and `npm run verify` (type check, build, security lint, security tests, secret scan) |
| **Neon · test migrations on a branch** (`neon-pr.yml`) | PRs that change `migrations/**` | Creates a fresh Neon branch `preview/pr-<n>` copied from production, applies all migrations, re-runs them (they must apply nothing), comments the schema diff on the PR, and deletes the branch when the PR closes. Production is never touched. |
| **Neon · migrate production** (`neon-migrate.yml`) | Manual (with a *dry run* option), or called by Deploy | Shows pending migrations. If any are pending, it takes an instant **backup branch** `backup/pre-migrate-<run>` (kept 7 days), then applies the migrations. |
| **Deploy** (`deploy.yml`) | Manual | verify → **migrate Neon** → deploy the Worker. The Worker only deploys if the migration succeeded. |

### One-time setup

1. **Connect Neon.** Either use the Neon GitHub integration (Neon console → Integrations → GitHub), which creates both of these for you, or add them by hand:
   - Repository **secret** `NEON_API_KEY`: Neon console → Account settings → API keys. Prefer a project-scoped key.
   - Repository **variable** `NEON_PROJECT_ID`: Neon console → Project settings.
2. **Create a `production` environment** (Settings → Environments). Add these **environment secrets**:
   - `DATABASE_URL`: the production **pooled** connection string
   - `CLOUDFLARE_API_TOKEN`: a token with the *Edit Cloudflare Workers* template
   - `CLOUDFLARE_ACCOUNT_ID`

   Under *Required reviewers*, add yourself, so every production migration and deploy waits for your approval.
3. Run **Actions → Neon · migrate production** once, with *dry run* ticked, to confirm the connection. Then run it again to create the tables.

Day to day:
- **New schema changes:** add a new file `migrations/0002_<name>.sql` (never edit an applied one; the script refuses changed checksums). Open a PR to test it on a Neon branch, merge it, then run **Deploy**.
- **Check the database locally:** `npm run db:status` shows what's applied and what's pending.
- **Write expand-then-contract migrations:** add new columns or tables first, and remove old ones in a later release. That way the running Worker never sees a schema it can't handle.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill DATABASE_URL with a Neon *dev branch*
npm run dev                      # http://localhost:4321  —  /admin works on localhost
```

`DEV_AUTH_BYPASS=true` only works when **both** of these hold:
- the dev server is running;
- the request is to `localhost`.

The bypass branch is removed at build time, so production builds never contain it.

## Checks

```bash
npm run verify          # astro check → build → security lint → security tests → client/repo secret scan
npm audit               # dependency vulnerabilities
```

CI runs both on every push. See [SECURITY.md](SECURITY.md) for the security design and the first-build scan report.
