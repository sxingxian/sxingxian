// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://sxingxian.com',
  output: 'server',
  // No Astro sessions: the admin is protected by Cloudflare Access, so no KV
  // namespace is provisioned and the session runtime stays out of the bundle.
  session: false,
  adapter: cloudflare({
    // Images are served through /media/:id; no Images binding needed.
    imageService: 'passthrough',
  }),
  integrations: [react()],
  security: {
    // Reject cross-site form posts to server routes.
    checkOrigin: true,
  },
  build: {
    // Keep styles in external files; scripts are nonce-tagged by middleware.
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      // Never inline scripts/assets as data: URIs or inline <script> bodies,
      // so the strict CSP (script-src 'self' + nonce) holds.
      assetsInlineLimit: 0,
    },
  },
});
