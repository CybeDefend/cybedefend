import { Injectable, Logger } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import { JiraService } from './jira.service';

@Injectable()
export class JiraWebhookCron {
  private readonly logger = new Logger(JiraWebhookCron.name);

  constructor(private readonly jiraService: JiraService) {}

  // Invoked by the K8s CronJob external-integrations-jira-webhook-refresh
  // (schedule "0 3 * * 0" in the Helm chart) via CRON_TASK=jira-webhook-refresh.
  // Failures PROPAGATE: the one-shot pod exits 1 so the Job's backoffLimit
  // retries it — the old always-on daemon swallowed them with a warn log.
  @Span()
  async handleWebhookRefresh(): Promise<void> {
    this.logger.log('[CRON] Starting weekly Jira webhook refresh...');
    await this.jiraService.refreshAllWebhooks();
    this.logger.log('[CRON] Jira webhook refresh completed.');
  }
}
