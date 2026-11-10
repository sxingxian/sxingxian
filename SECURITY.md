# Security

## Design

### No secrets on the client
- Every secret — the Neon connection string, `AUTH_SECRET`, `SETUP_TOKEN`, the webhook secret and storage keys — is a **Cloudflare Worker secret**. Secrets are read only through `import { env } from 'cloudflare:workers'` inside `src/lib/server/**`.
- The admin app (`src/admin/**`) imports only `src/lib/shared/**` (types, Zod schemas, URL helpers). The browser talks to `/api/admin/*` and holds no credentials it can read: the session cookie is HttpOnly. Help text that names a secret is rendered by the server, so even secret *names* never appear in the browser bundle (the scan enforces this).
- Media is always served through `/media/:id`. Storage hosts and keys are never exposed.
- `npm run security:scan` fails the build if any secret name, server-only module, connection string, key pattern or source map shows up in `dist/client`. It fails the same way if a secret file or secret-looking string is tracked by git.

### Deployment secrets
- **Cloudflare** holds the Worker's runtime secrets (set in the dashboard; `keep_vars` stops Git deploys from clearing them). Cloudflare Workers Builds deploys from Git, so no Cloudflare API token is stored in GitHub.
- **GitHub** holds only `NEON_API_KEY` (project-scoped) and the non-secret `NEON_PROJECT_ID`. The Deploy Neon workflow fetches the connection string from the Neon API at run time, masks it (and its password) in the logs, and runs under the `production` environment, which can require your approval.
- Workflows use least-privilege `permissions`, actions pinned to commit SHAs, `persist-credentials: false`, and automatic database deploys only for CI-passing pushes to this repository's `main` (never pull requests or forks).
- The Worker serves only `sxingxian.com`: `workers_dev` and `preview_urls` are off, so there is no unprotected `*.workers.dev` copy of the admin.

### Admin authentication and authorisation
Accounts are stored in Neon (`users`, `sessions`, `recovery_codes`, `auth_events`; migration `0002_users.sql`). Cloudflare Access is not used.

- **Passwords:** the Worker pre-hashes with SHA-256 (domain-separated, NFKC-normalised), and Neon stores `bcrypt(prehash)` at cost 12 via `pgcrypto`. The plaintext never leaves the Worker, bcrypt's 72-byte limit can't truncate long passphrases, and hashing runs on Neon rather than the Worker's CPU budget. Policy: 12–256 characters, not a common password, doesn't contain the email name.
- **No account enumeration:** unknown emails are checked against a dummy bcrypt hash and get the same message ("Email or password is incorrect"), with matching timing (measured: ~200 ms vs ~230 ms against local Postgres).
- **Brute force:** 10 attempts a minute per IP (Workers rate-limit binding), and after 5 consecutive failures from one IP for one email, that email+IP pair locks for 1 minute, doubling (capped) up to 1 hour. Unknown emails are throttled identically, so a lock reveals nothing about which accounts exist, and a stranger's failures never lock the owner out from another address. While locked, even the right password is refused for that pair.
- **Sessions:** a 256-bit random token in a `__Host-sx_session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`, no Domain), valid 7 days. Neon stores only its SHA-256, so a database leak doesn't hand out sessions. Every admin request re-checks the session and that the user is not disabled. Changing the password, a reset, or disabling the user deletes their other sessions. Users can see and revoke devices.
- **2-step sign-in (TOTP, RFC 6238):** ±1 time step; each step is accepted once (atomic `UPDATE … WHERE totp_last_step < step`), so a code can't be replayed. The TOTP secret is encrypted with AES-256-GCM, with the key derived from the `AUTH_SECRET` Worker secret via HKDF and the user id bound as additional data. 10 single-use recovery codes are stored as SHA-256. Turning 2-step off needs the password plus a code.
- **First account:** `/admin/setup` works only while the `users` table is empty **and** a 24+ character `SETUP_TOKEN` secret is set (compared in constant time). The insert runs in one transaction under an advisory lock with `WHERE NOT EXISTS (SELECT 1 FROM users)`, so two simultaneous requests can't both create an owner. Once any account exists, setup is closed whatever the token.
- **Roles:** `owner` (also manages users) and `admin` (content). Users can't demote or disable themselves, and the last active owner can't be removed. New users and resets get a random ~98-bit temporary password, shown once. The server only lets them change it (every other admin route returns 403) until they do.
- **Recovery without the site:** `npm run user -- reset-password | reset-2fa | unlock` uses the same hashing code from the command line, with the password typed at a hidden prompt (never an argument, so it stays out of shell history).
- **Audit trail:** sign-ins, failures, lockouts and account changes go to `auth_events` (kept 180 days), shown on the Account page.
- **No bypass:** there is no development sign-in bypass. Local development signs in against a Neon dev branch.

### Photo protection
- **Watermark:**
  - drawn in the admin's browser (canvas) and uploaded as a separate copy (`wm/<id>.webp|jpg`, magic bytes checked, 20 MB cap);
  - the upload must carry the fingerprint of the current watermark settings, so stale copies are rejected (409);
  - while the watermark is on, `/media/:id` serves only that copy, capped at 2560 px. The original is readable only through the admin-only `/api/admin/media/:id/original`;
  - a photo with no copy yet is served as is and listed as pending in Settings → Photos.
- **Documents** (PDF, Office, OpenDocument, RTF, text, Markdown, CSV, calendar):
  - accepted only if the bytes match an allowed type for the file's extension (`lib/server/filetypes.ts`): PDF header, OOXML/ODF zip structure, OLE header, RTF header, or valid UTF-8 text with no NUL bytes; calendars must start with `BEGIN:VCALENDAR`. HTML, SVG, XML, scripts and archives are never accepted; Office/ODF files containing macros are refused;
  - 25 MB cap; stored under `files/…` with a random name; the original name is cleaned and its extension forced to the real type;
  - served from `/media/<id>` as `Content-Disposition: attachment` with the recorded type, `nosniff` and a `sandbox` CSP, so a file can never run as a page on the site's origin. Photo protection rules apply to images only;
  - PDF previews are drawn by PDF.js into canvases (no PDF JavaScript, no XFA); the worker is same-origin (`worker-src 'self'`); its assets are served from `/pdfjs/`. "Download off" only hides the button — anything a visitor can see can be captured.
- **WordPress address** (admin-editable): https only, default port, no credentials/query, no IP literals or private/reserved names (`normalizeWpBase`); the server checks `/wp-json/` answers with the `wp/v2` API and never follows a redirect to another host. The CSP's image source follows the saved address.
- **NAS storage:** optional Cloudflare Access service token (`NAS_ACCESS_CLIENT_ID/SECRET`) sent with every NAS request, so the S3 address refuses anyone but this site.
- **Watermark logo** (one row in Neon, `watermark_logo`):
  - the admin re-encodes the picked image through a canvas to a PNG ≤512 px, which drops metadata and anything that isn't pixels. SVG is not accepted (it can carry script);
  - `PUT /api/admin/watermark-logo` (signed-in admin, CSRF header) accepts only `image/png`, checks the signature, a well-formed IHDR, ≤1024 px, ≤256 KB, and that the file ends at IEND (no appended data). The table enforces one row, the PNG type and the size again;
  - the logo is served only to signed-in admins, with `nosniff`, `no-store` and a `sandbox` CSP. It is never public;
  - its hash (`protection.logoHash`) is set only by the server; the settings endpoint ignores one sent by the browser. The hash is part of the watermark fingerprint, so a new logo marks copies stale.
- **Block saving:**
  - `/media/:id` refuses `Sec-Fetch-Dest: document`/`iframe` (an image URL opened in its own tab) and `Sec-Fetch-Site: cross-site` (hotlinking). It sends `Vary` on both headers;
  - link-preview bots and feed readers send no Sec-Fetch headers, so they still work;
  - on public pages, context menu and drag are blocked on images, along with the iOS long-press menu (`-webkit-touch-callout`).
- **Honest limit:** none of this stops screenshots or someone reading the network tab. The visible watermark and the size cap are the real protection.
- Media responses now cache for 1 hour (not a year), so switching the watermark reaches visitors quickly.

### Google AdSense
- Off by default. When on, only public pages that may show ads get Google's supported strict CSP for AdSense (support.google.com/adsense/answer/16283098):
  - scripts still need the per-request nonce, with `'strict-dynamic'`, and `base-uri 'none'`;
  - images, frames and connections are opened to `https:`, because Google doesn't publish a fixed domain list;
  - `'unsafe-eval'` is included because Google lists it as required for its ad code;
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups` keeps ad clicks working.
- The admin, `/api`, CV, About and Privacy always keep the tight policy and never load ad code.
- The publisher ID and slot IDs are validated as `ca-pub-` plus digits, and digits only, when saved and again when rendered, so settings can't inject markup.
- Consent for EEA/UK/Switzerland visitors is Google's certified consent message, configured in AdSense → Privacy & messaging. `Permissions-Policy` still blocks `browsing-topics`.

### Inline scripts
- Public pages carry two small inline scripts (theme before first paint; theme switch and phone menu). Like every `<script>`, they get the per-request CSP nonce, so `script-src` stays nonce-only with no `'unsafe-inline'`.
- They read and write a single non-sensitive `localStorage` key (`sx-theme`), never cookies or user data.

### Embeds
- Video embeds are stored as provider + id only, checked against fixed patterns, and rendered only from fixed hosts in sandboxed iframes:
  - `youtube-nocookie.com` (including Shorts);
  - `player.vimeo.com`;
  - `www.tiktok.com/player/v1/<numeric id>`.
- Maps are stored as numbers only (lat/lon range-checked, zoom clamped 2–19) and rendered as an OpenStreetMap embed. No API key is needed and no third-party script runs.
- CSP `frame-src` lists exactly these hosts.
- `/api/admin/resolve-link` (admin only) expands TikTok share links. It follows at most 4 redirects, https only, and only to `*.tiktok.com`, so it can't be used to reach other or internal addresses.
- `/api/admin/geocode` (admin only) asks OpenStreetMap Nominatim, on Enter only, and returns validated coordinates.
- Browser `alert`/`confirm`/`prompt` are not used. The admin uses its own accessible dialog with a focus trap, Esc to cancel, and focus restored afterwards.

### Cross-site request forgery
- Admin API and sign-in API (`/api/auth/*`) writes (POST, PUT, PATCH, DELETE) require **both**:
  - an `Origin` header equal to the site origin;
  - a custom `X-Sx-Admin: 1` header, which can't be sent cross-site without a CORS preflight the API never grants.
- Astro's `security.checkOrigin` is also on, and the session cookie is `SameSite=Strict`.
- After sign-in, `?next=` is accepted only if, after URL normalisation, it is an `/admin` path on this site (no other origins, `..`, backslashes or encoded dots).

### Injection
- **SQL:** every query uses Neon's tagged template or `$n` parameters. There is no string-built SQL.
- **Stored content (XSS):** the editor's JSON becomes HTML **only** through the allow-list renderer in `src/lib/server/render.ts`. It:
  - escapes every string;
  - drops unknown nodes and marks;
  - allows only links that are `https:`, site-relative or `mailto:`;
  - accepts media IDs only as UUIDs;
  - turns embeds into fixed YouTube/Vimeo iframe URLs only;
  - sanitises code languages;
  - allows column widths only as clamped numbers;
  - renders galleries only from UUID media IDs (at most 30), a fixed layout name (`grid`/`masonry`), columns clamped to 2–4, alt text cut to 300 characters and image sizes clamped to whole numbers;
  - caps nesting depth.

  There is no raw-HTML block.
- **WordPress content:** titles and excerpts are reduced to plain text, then escaped when rendered. Only `https://` image URLs are stored.
- **Validation:** every write is checked with Zod on the server, with body-size caps (1.2 MB for documents, 50 KB for settings).
- **Topics:** entry topics (max 3 × 30 chars) and section lists (max 12 each) are validated, trimmed and de-duplicated on the server; renames run as one parameterised `UPDATE` per change, scoped to that section's kind. Public topic filters accept only values in the saved list.

### Content Security Policy and headers
- A per-request nonce is set by middleware and stamped on every `<script>` with `HTMLRewriter`:
  `script-src 'nonce-…' 'strict-dynamic' 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
- Images, frames and connections are limited to the site, hey.sxingxian.com, YouTube-nocookie and Vimeo.
- **Other headers:**
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS;
  - `no-store` and `noindex` on admin pages.
- Media responses carry `default-src 'none'; sandbox` and a fixed `Content-Type`.
- Fonts are self-hosted, so there are no third-party requests on public pages.

### Uploads
- **Type check:** the server checks the declared type **and magic bytes**. It accepts only JPEG, PNG, WebP, GIF, AVIF, MP4 and WebM; SVG and HTML are rejected.
- **Size limits:** 25 MB for images, 95 MB for video.
- **Video hosting:** video goes to R2 only, which keeps the site within Cloudflare's CDN terms.
- **Metadata:** GPS location and camera serials are stripped in the browser, by re-encoding through a canvas, before upload. This is on by default.
- **File names:** object keys are random UUIDs and user file names are never used as paths. S3 credentials are only ever sent to `https://` endpoints.

### WordPress webhook
- `HMAC-SHA256(secret, timestamp + "." + body)`:
  - verified with constant-time `crypto.subtle.verify`;
  - rejected if older than ±5 minutes;
  - the secret must be at least 32 characters.
- The payload carries only a post ID; the post itself is fetched back from WordPress.
- The endpoint is rate-limited (Workers Rate Limiting binding), and body size is capped at 2 KB.

### Supply chain
- `npm audit` runs in CI.
- Dependabot opens weekly updates.
- A `minimatch` override pins the patched release that the lint tooling depends on.

## First-build security scan — 8 Nov 2026

| Check | Tool | Result |
|---|---|---|
| Dependency vulnerabilities | `npm audit` (all 1,000+ packages) | **0 vulnerabilities.** Earlier findings were fixed by dropping `drizzle-kit` (esbuild advisory) and overriding `minimatch` to 11.0.5 (GHSA-g3hv-75wg-m249, via ESLint tooling). |
| Type safety | `astro check` | **0 errors, 0 warnings** |
| Static analysis | ESLint + `eslint-plugin-security` + Mozilla `eslint-plugin-no-unsanitized` | **Clean** after triage (below) |
| XSS / injection regression tests | `npm run test:security` | **22/22 pass.** Covers script/attribute injection, `javascript:`/`data:`/protocol-relative links, CSS injection via column widths, malicious embed IDs, path-traversal media IDs and deep nesting. |
| Secrets in client bundle and repo | `npm run security:scan` | **Clean.** 1 false positive fixed: a placeholder connection string in `.dev.vars.example` was removed rather than weakening the pattern. |
| Runtime: auth gate (v0.1, Cloudflare Access; since replaced) | Production build in `astro preview` (workerd) | `/admin` and `/api/admin/me` → **401** without a token, with a forged `alg:none` token, and even with `DEV_AUTH_BYPASS=true` on localhost. |
| Runtime: CSRF guard | dev server | Writes without `X-Sx-Admin` or from a foreign `Origin` → **403**. |
| Runtime: CSP | dev server | CSP header present; **every** `<script>` carries the nonce (0 without). |
| Runtime: webhook | dev server | Bad or expired signature → **401** |

### Accounts update — 8 Nov 2026 (Cloudflare Access → Neon accounts)

| Check | Tool | Result |
|---|---|---|
| Unit tests | `npm run test:security` | **34/34 pass.** New: RFC 6238 TOTP vectors; replay and old-code rejection; AES-GCM tamper, wrong-key and wrong-user rejection; pre-hash normalisation and no 72-byte truncation; password policy; randomness and format of tokens and codes; cookie attributes; `next` redirect allow-list; payload bounds. |
| Sign-in logic against real Postgres 16 | `src/lib/server/users.ts` through a Neon-HTTP shim | Pass: setup closes after the first account; correct and incorrect passwords; same message for unknown emails; lockout on the 5th failure (and it holds with the right password); session lookup, forged, expired and disabled-user sessions refused; only hashes stored; 2-step required, wrong code refused, code replay refused; recovery code works once; duplicate email (23505); upper-case email rejected by a CHECK constraint. |
| Runtime: auth gate | production build in `astro preview` (workerd) | `/admin/*` → **303** to `/admin/login?next=…`; `/api/admin/me` → **401**; a forged session cookie fails closed; sign-in and setup POSTs without the header or from a foreign origin → **403**; sign-in page has a nonce on every script, `no-store`, `noindex` and `frame-ancestors 'none'`. |
| Client bundle | `npm run security:scan` | Clean. It now also fails on `AUTH_SECRET`, `SETUP_TOKEN`, `password_hash`, `totp_secret_enc`, `gen_salt` and the session hash label. |
| Dependencies | `npm audit` | 0 vulnerabilities. Removed `jose`; added `uqr` (MIT, no dependencies) for the QR code. |

**Lint triage**
- **Fixed:** WordPress category → topic lookup now uses `Object.hasOwn`. A category literally named `__proto__` would otherwise have broken mapping.
- **Fixed:** the slug regex is now length-guarded (`isSlug`) before matching, and the schema checks `max(80)` first.
- **Accepted, with rationale:** `detect-object-injection` is off, because all flagged lookups (39) index typed constant maps or keys validated first. `detect-non-literal-fs-filename` is off for `scripts/` (fixed project paths). Test payloads are exempt from `no-script-url`.

**Not run in this environment:**
- Semgrep: its rule registry couldn't be reached through the build sandbox's network allowlist.
- Gitleaks: an external binary download was blocked.

**Recommended:** turn on **GitHub secret scanning, push protection and Dependabot alerts** in the repository settings (free for private repos with GitHub Advanced Security, or public repos), and optionally add Semgrep to CI.

## Known trade-offs
- `style-src` allows `'unsafe-inline'` because the editor and a few layout attributes set inline styles. Scripts remain nonce-only, and stored content cannot emit `style` attributes except clamped numeric column widths.
- The settings and WordPress-status caches live per Worker isolate (15–20 s), so changes can take a few seconds to show everywhere.
- Admin sign-in is self-hosted, so turn on **2-step sign-in** for every account, and keep `AUTH_SECRET` in a password manager: if it is lost, 2-step must be reset (from Users or the command line) and set up again.
- The sign-in throttle is per email and IP, not per account, so a distributed attack across many IPs is limited only by the per-IP rate limit and the password policy; the trade-off is that nobody can lock the owner out from their own address. Owners and the command line can clear a throttle at once.

## Reporting
Please email the site owner privately rather than opening a public issue.
