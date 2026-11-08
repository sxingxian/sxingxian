// Worker entry: Astro handles HTTP; the scheduled handler runs WordPress jobs.
import { handle } from '@astrojs/cloudflare/handler';
import { healthCheck, reconcile, syncIncremental, log } from './lib/server/wordpress';
import { purgeAuthData } from './lib/server/users';

async function runCron(cron: string, scheduledTime: number): Promise<void> {
  try {
    if (cron === '0 19 * * *') {
      await purgeAuthData().catch(() => {});
      await reconcile();
      return;
    }
    const status = await healthCheck();
    const minute = new Date(scheduledTime).getUTCMinutes();
    if (status === 'up' && minute % 15 === 0) await syncIncremental();
  } catch (e) {
    await log(`Cron ${cron}`, `error: ${e instanceof Error ? e.message : 'unknown'}`, false).catch(() => {});
  }
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  scheduled(controller, _env, ctx) {
    ctx.waitUntil(runCron(controller.cron, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
