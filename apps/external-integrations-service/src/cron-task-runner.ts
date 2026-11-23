import type { JiraWebhookCron } from './modules/jira/jira-webhook.cron';
import type { GitlabWebhookTokenMigration } from './modules/gitlab/gitlab-webhook-token-migration';

/**
 * One-shot dispatcher for the external-integrations Kubernetes CronJobs.
 *
 * Scheduling lives in native K8s CronJobs (Helm:
 * services.externalIntegrations.cronJobs) — each entry launches a short-lived
 * pod with CRON_TASK set; the process runs the task once and exits. This map
 * is the single source of truth for the accepted values; the schedule itself
 * lives in the Helm chart. Same pattern as analysis-reporting's
 * report-mail-task-runner.
 */
export interface CronTaskDeps {
  jiraWebhookCron?: JiraWebhookCron;
  gitlabWebhookTokenMigration?: GitlabWebhookTokenMigration;
}

function required<K extends keyof CronTaskDeps>(
  deps: CronTaskDeps,
  key: K,
): NonNullable<CronTaskDeps[K]> {
  const dep = deps[key];
  if (!dep) {
    throw new Error(`${key} is not loaded in this process`);
  }
  return dep;
}

const TASKS = {
  'jira-webhook-refresh': async (deps: CronTaskDeps) =>
    required(deps, 'jiraWebhookCron').handleWebhookRefresh(),
  // One-shot, run by hand (not scheduled): gives every GitLab hook still
  // registered with the OAuth application secret its own token.
  'gitlab-webhook-token-migration': async (deps: CronTaskDeps) => {
    await required(deps, 'gitlabWebhookTokenMigration').run();
  },
} as const;

export type CronTask = keyof typeof TASKS;

export const CRON_TASKS = Object.keys(TASKS) as CronTask[];

/**
 * Runs exactly one task and resolves when it completes. Throws on
 * unknown/missing task and propagates task failures — the caller exits
 * non-zero so the K8s Job retries (backoffLimit) and the failure stays
 * visible instead of being swallowed.
 */
export async function runCronTask(
  deps: CronTaskDeps,
  task: string | undefined,
): Promise<void> {
  const valid = CRON_TASKS.join(', ');
  if (!task) {
    throw new Error(
      `CRON_TASK is required (expected one of: ${valid}). ` +
        'This process runs as a one-shot Kubernetes CronJob and no longer self-schedules.',
    );
  }
  const run = TASKS[task as CronTask];
  if (!run) {
    throw new Error(`Unknown CRON_TASK "${task}" (expected one of: ${valid})`);
  }
  await run(deps);
}

/**
 * The Nest module a task needs: the GitLab token migration loads the GitLab
 * module (Redis, queues, gRPC clients); every other task keeps the light
 * webhook module.
 */
export function cronModuleKind(task: string | undefined): 'gitlab' | 'webhook' {
  return task === 'gitlab-webhook-token-migration' ? 'gitlab' : 'webhook';
}
