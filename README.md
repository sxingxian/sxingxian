# sxingxian.com

A stories-first personal site with a Notion-style CMS. Posts you write here and posts from the WordPress site at **hey.sxingxian.com** appear in one feed. Work, photos, film, a CV page and an About page sit alongside, and each can be switched on or off.

- **Public site:** `https://sxingxian.com`
- **Admin:** `https://sxingxian.com/admin` (own sign-in; accounts stored in Neon)
- **WordPress site:** `https://hey.sxingxian.com` (its own admin: `https://hey.sxingxian.com/admin`)

## Stack

| Part | Choice |
|---|---|
| Framework | Astro 7, server-rendered on **Cloudflare Workers** |
| Admin | React app at `/admin`, editor built on **Tiptap 3**: slash menu, drag handles, resizable 2/3-column blocks |
| Database | **Neon** Postgres over HTTP (`@neondatabase/serverless`), parameterised SQL only |
| Media | Choose per upload: **Cloudflare R2**, your **NAS** (S3-compatible, via Cloudflare Tunnel) or **Backblaze B2**; YouTube/Vimeo for long video |
| Auth | Own accounts in **Neon**: bcrypt passwords (pgcrypto), HttpOnly `__Host-` session cookie, optional authenticator-app 2-step with recovery codes, lockout + per-IP rate limit |
| Jobs | WordPress health check, sync, daily reconcile and session clean-up, started by site traffic and claimed atomically in Neon. **No cron triggers needed** (the free plan allows 5 per account); one optional `*/5 * * * *` trigger runs the same jobs. |

Public pages ship **no framework JavaScript**: only two small inline scripts (apply the saved theme before first paint; theme switch and phone menu). Only `/admin` loads the editor bundle.

**Mobile and dark mode:** every page is responsive (phone menu sheet, sideways-scrolling topics, stacked footer; in the admin a bottom tab bar, card lists and a bottom-sheet publish panel). The theme follows the device by default; the sun/moon button, the phone menu, the footer and the admin sidebar switch System / Light / Dark, remembered per device (`localStorage` key `sx-theme`, shared by site and admin).

## Features

- **Stories home (`/`, all at `/story`):** a featured post, latest posts (native + WordPress) with topic filters, RSS, and sidebar cards for Work, Photos and Film.
- **Tagline:** shown next to the site name; leave it empty in Settings to show the current section's name instead (stories, work, photos, cv…).
- **Featured post:** pin a post in the admin (Settings → Sections & featured post, or the "Feature on home page" switch in the editor), or leave it on *Always show the latest post*.
- **Section switches:** Work, Photos, Film, CV and About can each be turned off. They leave the menu and home page, their pages return 404, and their content is kept.
- **Notion-style editor:**
  - **Blocks:** text, headings, lists, quote, callout, code, divider.
  - **Media:** images (with alt text, caption and width), YouTube and Vimeo, vertical YouTube Shorts and TikTok, and maps (OpenStreetMap; search a place, or paste coordinates or a Google Maps/OSM link).
  - **Layout:** 2- or 3-column blocks with draggable dividers, presets, gap, phone stacking and dividers.
  - **Editing:** a formatting bubble and drag handles.
- **CV page** (`/cv`): built from column blocks, printable to PDF from the browser (print stylesheet included).
- **Editable footer:** about text, up to 3 link columns, bottom line with `{year}`. Links are allow-listed.
- **WordPress sync** (see below), with automatic hiding when WordPress is down.
- **Photos:**
  - tapping a photo opens a full-screen lightbox, in posts and galleries and in the admin's Media page (arrows, swipe, Esc);
  - Settings → **Photos** turns a watermark on or off (optional logo left of the text, stored in Neon; text, position, size, opacity, live preview). It is baked into public copies capped at 2560 px, new uploads are watermarked automatically, and "Apply" updates existing photos. Originals stay private, so turning it off restores them;
  - **Block saving** (on by default) stops right-click, drag and long-press saving, and refuses image URLs opened on their own or embedded on other sites.
- **Google AdSense** (optional, Settings → Ads): a publisher ID, plus optional units on the home page and at the end of posts. `/ads.txt` is generated. Ads never appear in the admin or on CV, About and Privacy. An editable **Privacy** page (draft template included) is linked in the footer once written.
- **RSS** at `/rss.xml`. There is no newsletter or email collection.

## Project layout

```
src/
  worker.ts                 Worker entry: Astro fetch handler + optional cron handler
  middleware.ts             session check, CSRF guard, CSP nonce, security headers
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
| Secrets | Cloudflare → `sxingxian` → Settings → Variables and secrets (`DATABASE_URL`, `AUTH_SECRET`, `SETUP_TOKEN` (first account only), `WP_WEBHOOK_SECRET`). GitHub holds only `NEON_API_KEY` + `NEON_PROJECT_ID`. |
| Admin accounts | First owner via `/admin/setup` (one-time) or `npm run user -- create`. More users in Admin → Users. See [docs/DEPLOYMENT.md §7](docs/DEPLOYMENT.md#7-first-admin-account). |

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
| Incremental pull | About every 15 min* | `GET /wp-json/wp/v2/posts?modified_after=…` catches missed webhooks. |
| Reconcile | Daily* | Compares every published ID and marks deleted, trashed or private posts as removed. |
| Health check | About every 5 min* | `GET /wp-json/` (5 s timeout). **2 failures in a row hide all WordPress posts** (feed, topic filters, RSS); **2 successes** show them again. |

\* These jobs run in the background when the site gets a visit (at most once per interval, claimed atomically in the `jobs` table), so no Cloudflare cron trigger is needed. If nobody visits, nothing runs. After a quiet spell, the first visit can still see the last known WordPress status for a moment while it starts a fresh check in the background. New posts still arrive straight away through the webhook. The admin's WordPress page has **Sync now**, **Check now** and **Full check** buttons.

Only the title, excerpt, featured image and link are copied. Cards link to WordPress, which stays the canonical page.

## Local development

```bash
cp .dev.vars.example .dev.vars        # DATABASE_URL = a Neon *dev branch*, plus AUTH_SECRET
export DATABASE_URL='…dev branch…'
npm run db:migrate
npm run user -- create you@example.com --role owner
npm run dev                           # http://localhost:4321/admin → sign in
```

There is no sign-in bypass, in development or production. `npm run user -- list | reset-password | reset-2fa | unlock | disable | enable` manages accounts from the command line.

## Checks

```bash
npm run verify          # astro check → build → security lint → security tests → client/repo secret scan
npm audit               # dependency vulnerabilities
```

CI runs both on every push. See [SECURITY.md](SECURITY.md) for the security design and the first-build scan report.
