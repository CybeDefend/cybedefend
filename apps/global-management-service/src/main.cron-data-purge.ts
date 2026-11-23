import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { DataPurgeCronModule } from './data-purge.cron.module';
import { DataPurgeRunner } from './modules/data-purge/data-purge.runner';

/**
 * One-shot entrypoint for the `global-management-data-purge` CronJob (Helm:
 * services.globalManagement.cronJobs, APP_MODE=cron-data-purge, every 10
 * minutes). It runs the purge jobs that are due once and exits: 0 on
 * success, including a run where steps failed and were scheduled again (the
 * ledger records them, DATA_PURGE_STUCK alerts on them); 1 on an unexpected
 * failure, so the Job's backoffLimit retries it and the failure stays visible
 * in `kubectl get jobs`. Every step is idempotent and claimed under a lease,
 * so a retried run never races another runner.
 *
 * Local run: pnpm run start:cron:data-purge
 */
async function bootstrap() {
  await tracer.start();
  dotenv.config();
  const app = await NestFactory.createApplicationContext(DataPurgeCronModule, {
    bufferLogs: true,
  });
  // Nest's own logger writes to the console, which nothing collects: every
  // `new Logger()` of this context goes through pino from here on.
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  try {
    const summary = await app.get(DataPurgeRunner).runDue();
    logger.log(`Data purge run done: ${JSON.stringify(summary)}`);
    await app.close();
    process.exit(0);
  } catch (err) {
    // The class only: a driver or service error can quote customer data.
    logger.error(
      `Data purge run failed: ${(err as Error)?.constructor?.name ?? 'unknown'}`,
    );
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console -- the bootstrap failed before a logger existed
  console.error(
    'Fatal error in data purge cron bootstrap:',
    (err as Error)?.constructor?.name ?? 'unknown',
  );
  process.exit(1);
});
