// Worker entry: Astro handles HTTP. Background jobs (WordPress checks, clean-up) are
// started by site traffic (see lib/server/maintenance.ts), so no cron trigger is needed.
// If you add a cron trigger in wrangler.jsonc, it runs the same jobs.
import { handle } from '@astrojs/cloudflare/handler';
import { runMaintenance } from './lib/server/maintenance';

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runMaintenance());
  },
} satisfies ExportedHandler<Env>;
