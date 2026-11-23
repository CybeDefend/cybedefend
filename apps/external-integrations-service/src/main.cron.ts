import tracer from './tracer';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as dotenv from 'dotenv';
import { Logger } from 'nestjs-pino';
import { CronWebhookModule } from './cron.webhook.module';
import { JiraWebhookCron } from './modules/jira/jira-webhook.cron';
import { CronGitlabWebhookTokenModule } from './cron.gitlab-webhook-token.module';
import { GitlabWebhookTokenMigration } from './modules/gitlab/gitlab-webhook-token-migration';
import { cronModuleKind, runCronTask } from './cron-task-runner';

/**
 * One-shot entrypoint for the external-integrations Kubernetes CronJobs.
 *
 * Scheduling lives in native K8s CronJobs (Helm:
 * services.externalIntegrations.cronJobs) — each launches this process with
 * CRON_TASK set (currently: jira-webhook-refresh, Sundays 03:00 UTC). The
 * process runs the task once and exits: 0 on success, 1 on failure so the
 * Job's backoffLimit retries it and the failure stays visible in
 * `kubectl get jobs`.
 *
 * The previous always-on Deployment (external-integrations-cron-webhook)
 * burned a pod 24/7 to self-schedule this single weekly task with NestJS
 * @Cron — and swallowed its failures with a warn log.
 *
 * Local run: CRON_TASK=jira-webhook-refresh pnpm run start:cron:webhook
 *
 * `gitlab-webhook-token-migration` is not scheduled: it is run once by hand
 * (CRON_TASK=gitlab-webhook-token-migration node dist/main.cron) and loads
 * the GitLab module instead of the Jira one.
 */
async function bootstrap() {
  await tracer.start();
  dotenv.config();
  const task = process.env.CRON_TASK;
  const kind = cronModuleKind(task);
  const app = await NestFactory.createApplicationContext(
    kind === 'gitlab' ? CronGitlabWebhookTokenModule : CronWebhookModule,
    { bufferLogs: true },
  );
  // Nest's own logger writes to the console, which nothing collects: every
  // `new Logger()` of this context goes through pino from here on.
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  try {
    logger.log(
      `external-integrations one-shot started (task=${task ?? '<unset>'})`,
    );
    await runCronTask(
      kind === 'gitlab'
        ? { gitlabWebhookTokenMigration: app.get(GitlabWebhookTokenMigration) }
        : { jiraWebhookCron: app.get(JiraWebhookCron) },
      task,
    );
    logger.log(`Task "${task}" completed`);
    await app.close();
    process.exit(0);
  } catch (err) {
    logger.error(
      `Task "${task ?? '<unset>'}" failed: ${(err as Error).message}`,
      (err as Error).stack,
    );
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}
bootstrap().catch((err) => {
  console.error('Fatal error in external-integrations cron bootstrap:', err);
  process.exit(1);
});
