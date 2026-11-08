# Security

## Design

### No secrets on the client
- Every secret — the Neon connection string, Access audience tag, webhook secret and storage keys — is a **Cloudflare Worker secret**. Secrets are read only through `import { env } from 'cloudflare:workers'` inside `src/lib/server/**`.
- The admin app (`src/admin/**`) imports only `src/lib/shared/**` (types, Zod schemas, URL helpers). The browser talks to `/api/admin/*` and holds no credentials. The Cloudflare Access cookie is HttpOnly and managed by Cloudflare.
- Media is always served through `/media/:id`. Storage hosts and keys are never exposed.
- `npm run security:scan` fails the build if any secret name, server-only module, connection string, key pattern or source map shows up in `dist/client`. It fails the same way if a secret file or secret-looking string is tracked by git.

### Deployment secrets
- **Cloudflare** holds the Worker's runtime secrets (set in the dashboard; `keep_vars` stops Git deploys from clearing them). Cloudflare Workers Builds deploys from Git, so no Cloudflare API token is stored in GitHub.
- **GitHub** holds only `NEON_API_KEY` (project-scoped) and the non-secret `NEON_PROJECT_ID`. The Deploy Neon workflow fetches the connection string from the Neon API at run time, masks it (and its password) in the logs, and runs under the `production` environment, which can require your approval.
- Workflows use least-privilege `permissions`, actions pinned to commit SHAs, `persist-credentials: false`, and automatic database deploys only for CI-passing pushes to this repository's `main` (never pull requests or forks).
- The Worker serves only `sxingxian.com`: `workers_dev` and `preview_urls` are off, so there is no unprotected `*.workers.dev` copy of the admin.

### Admin authentication and authorisation
- Cloudflare Access protects `/admin*` and `/api/admin*` at the edge.
- `src/middleware.ts` **also verifies the Access JWT on every request**:
  - RS256 signature against the team JWKS, plus issuer, audience and expiry;
  - the email must be in `ADMIN_EMAILS`.

  A misconfigured or bypassed Access policy still results in 401.
- **Local dev bypass:** it works only in `astro dev`, only on `localhost`, and only with `DEV_AUTH_BYPASS=true`. The `import.meta.env.DEV` guard removes it from production builds. This was verified on the built worker: with the variable set, `/admin` still returns 401.

### Cross-site request forgery
- Admin API writes (POST, PUT, PATCH, DELETE) require **both**:
  - an `Origin` header equal to the site origin;
  - a custom `X-Sx-Admin: 1` header, which can't be sent cross-site without a CORS preflight the API never grants.
- Astro's `security.checkOrigin` is also on.

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
  - caps nesting depth.

  There is no raw-HTML block.
- **WordPress content:** titles and excerpts are reduced to plain text, then escaped when rendered. Only `https://` image URLs are stored.
- **Validation:** every write is checked with Zod on the server, with body-size caps (1.2 MB for documents, 50 KB for settings).

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
| Runtime: auth gate | Production build in `astro preview` (workerd) | `/admin` and `/api/admin/me` → **401** without a token, with a forged `alg:none` token, and even with `DEV_AUTH_BYPASS=true` on localhost. |
| Runtime: CSRF guard | dev server | Writes without `X-Sx-Admin` or from a foreign `Origin` → **403**. |
| Runtime: CSP | dev server | CSP header present; **every** `<script>` carries the nonce (0 without). |
| Runtime: webhook | dev server | Bad or expired signature → **401** |

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
- The admin relies on Cloudflare Access for login. Keep the Access policy restricted to your email, and enable a second factor in your identity provider.

## Reporting
Please email the site owner privately rather than opening a public issue.
