import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { ReportRetentionCronModule } from './report-retention.cron.module';
import { ReportRetentionService } from './modules/reports/retention/report-retention.service';

/**
 * One-shot entrypoint for the report-retention purge K8s CronJob.
 *
 * Deletes every report past its plan-derived `expiresAt`: the stored object first,
 * then the DB row (so the quota count and storage stay consistent). Loops in
 * batches until a pass clears nothing (or a safety cap), so a single run drains
 * the backlog. Exits 0 on success / 1 on failure so the Job's backoffLimit
 * retries and failures stay visible in `kubectl get jobs`.
 *
 * Local run: pnpm run start:cron:report-retention
 */
const MAX_PASSES = 50; // safety cap: MAX_PASSES * batchSize rows per invocation

async function bootstrap() {
  await tracer.start();
  dotenv.config();
  const app = await NestFactory.createApplicationContext(
    ReportRetentionCronModule,
    { bufferLogs: true },
  );
  // Nest's own logger writes to the console, which nothing collects: every
  // `new Logger()` of this context goes through pino from here on.
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  try {
    logger.log('Report retention purge one-shot started');
    const svc = app.get(ReportRetentionService);
    // First settle zombie queued rows (worker died mid-generation) so they stop
    // holding a quota slot, then purge everything past its retention.
    const stale = await svc.failStaleQueued();
    if (stale.generated || stale.aggregated) {
      logger.log(
        `Report retention: failed ${stale.generated + stale.aggregated} stale queued report(s)`,
      );
    }
    let generated = 0;
    let aggregated = 0;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const res = await svc.purgeExpired();
      generated += res.generated;
      aggregated += res.aggregated;
      if (res.generated === 0 && res.aggregated === 0) break;
    }
    logger.log(
      `Report retention purge completed: generated=${generated} aggregated=${aggregated}`,
    );
    await app.close();
    process.exit(0);
  } catch (err) {
    logger.error(
      `Report retention purge failed: ${(err as Error).message}`,
      (err as Error).stack,
    );
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console -- the bootstrap failed before a logger existed
  console.error('Fatal error in report retention cron bootstrap:', err);
  process.exit(1);
});
