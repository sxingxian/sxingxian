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

## Deploying

**Full step-by-step guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).** In short:

| What | Where it goes live |
|---|---|
| Code | **Cloudflare Workers Builds** (Worker connected to this repo): every push to `main` builds and deploys `sxingxian` on `sxingxian.com`. |
| Database | **Actions → Deploy Neon**: checks CI passed, backs up production to a Neon branch, applies `migrations/*.sql`. Manual, or automatic after CI with `AUTO_DEPLOY_NEON=true`. |
| Secrets | Cloudflare → `sxingxian` → Settings → Variables and secrets (`DATABASE_URL`, `ACCESS_AUD`, `WP_WEBHOOK_SECRET`, `ACCESS_TEAM_DOMAIN`, `ADMIN_EMAILS`). GitHub holds only `NEON_API_KEY` + `NEON_PROJECT_ID`. |

### GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`ci.yml`) | Every push and PR | `npm audit`, `npm run verify` (type check, build, security lint, security tests, secret scan) and a `wrangler deploy --dry-run` of the Worker |
| **Neon · test migrations on a branch** (`neon-pr.yml`) | PRs that change `migrations/**` | Copies production to `preview/pr-<n>`, applies the migrations twice (second run must be a no-op), comments the schema diff, deletes the branch on close. Production is never touched. |
| **Deploy Neon** (`neon-deploy.yml`) | Manual (with *dry run*), or after CI on `main` when `AUTO_DEPLOY_NEON=true` | Refuses commits whose CI failed, gets the connection string from the Neon API, takes a backup branch `backup/pre-migrate-<run>` (7 days), applies pending migrations. |

## How the WordPress sync works

| Path | When | What |
|---|---|---|
| Webhook | On publish, edit, unpublish or delete | The plugin sends only `{post_id, action}`, signed with HMAC-SHA256 and a timestamp (rejected after 5 min). The site then **fetches that post from the WordPress REST API itself**, so forged or tampered payloads can't inject content. |
| Incremental pull | Every 15 min | `GET /wp-json/wp/v2/posts?modified_after=…` catches missed webhooks. |
| Reconcile | Nightly, 03:00 SGT | Compares every published ID and marks deleted, trashed or private posts as removed. |
| Health check | Every 5 min | `GET /wp-json/` (5 s timeout). **2 failures in a row hide all WordPress posts** (feed, topic filters, RSS); **2 successes** show them again. |

Only the title, excerpt, featured image and link are copied. Cards link to WordPress, which stays the canonical page.

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
