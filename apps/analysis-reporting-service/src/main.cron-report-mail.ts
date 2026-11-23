import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { ReportMailCronModule } from './report.mail.cron.module';
import { ReportMailCron } from './modules/report-mail/report-mail.cron';
import { runReportMailTask } from './modules/report-mail/report-mail-task-runner';

/**
 * One-shot entrypoint for the report-mail Kubernetes CronJobs.
 *
 * Scheduling lives in native K8s CronJobs (Helm:
 * services.analysisReporting.cronJobs) — one per cadence (weekly / monthly /
 * daily), each launching this process with CRON_TASK set. The process runs
 * the task once and exits: 0 on success, 1 on failure so the Job's
 * backoffLimit retries it and the failure stays visible in `kubectl get jobs`.
 *
 * There is deliberately no long-running mode anymore: the previous always-on
 * Deployment burned a pod 24/7 for a punctual task (and a leftover debug
 * @Cron(EVERY_10_SECONDS) had the weekly handler firing nonstop).
 *
 * Local run: CRON_TASK=daily pnpm run start:cron:report-mail
 */
async function bootstrap() {
  await tracer.start();
  dotenv.config();
  const task = process.env.CRON_TASK;
  const app = await NestFactory.createApplicationContext(ReportMailCronModule, {
    bufferLogs: true,
  });
  // Nest's own logger writes to the console, which nothing collects: every
  // `new Logger()` of this context goes through pino from here on.
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  try {
    logger.log(`Report Mail one-shot started (task=${task ?? '<unset>'})`);
    await runReportMailTask(app.get(ReportMailCron), task);
    logger.log(`Report Mail task "${task}" completed`);
    await app.close();
    process.exit(0);
  } catch (err) {
    logger.error(
      `Report Mail task "${task ?? '<unset>'}" failed: ${(err as Error).message}`,
      (err as Error).stack,
    );
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console -- the bootstrap failed before a logger existed
  console.error('Fatal error in Report Mail cron bootstrap:', err);
  process.exit(1);
});
