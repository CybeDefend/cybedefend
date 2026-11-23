import { ReportMailCron } from './report-mail.cron';

/**
 * One-shot dispatcher for the report-mail Kubernetes CronJobs.
 *
 * Scheduling moved OUT of the process (NestJS @Cron in an always-on
 * Deployment) into native K8s CronJobs — one per cadence, each launching a
 * short-lived pod with CRON_TASK set. This map is the single source of truth
 * for the accepted values; the schedule itself lives in the Helm chart
 * (charts/cybedefend: services.analysisReporting.cronJobs).
 */
const TASKS = {
  weekly: (cron: ReportMailCron) => cron.runWeekly(),
  monthly: (cron: ReportMailCron) => cron.runMonthly(),
  daily: (cron: ReportMailCron) => cron.runDailyCritical(),
} as const;

export type ReportMailTask = keyof typeof TASKS;

export const REPORT_MAIL_TASKS = Object.keys(TASKS) as ReportMailTask[];

/**
 * Runs exactly one report-mail task and resolves when it completes.
 * Throws on unknown/missing task and propagates task failures — the caller
 * exits non-zero so the K8s Job retries (backoffLimit) and surfaces the
 * failure instead of swallowing it.
 */
export async function runReportMailTask(
  cron: ReportMailCron,
  task: string | undefined,
): Promise<void> {
  const valid = REPORT_MAIL_TASKS.join(', ');
  if (!task) {
    throw new Error(
      `CRON_TASK is required (expected one of: ${valid}). ` +
        'This process runs as a one-shot Kubernetes CronJob and no longer self-schedules.',
    );
  }
  const run = TASKS[task as ReportMailTask];
  if (!run) {
    throw new Error(`Unknown CRON_TASK "${task}" (expected one of: ${valid})`);
  }
  await run(cron);
}
