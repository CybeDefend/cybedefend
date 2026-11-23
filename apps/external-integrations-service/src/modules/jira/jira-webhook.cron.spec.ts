import { Test, TestingModule } from '@nestjs/testing';
import { JiraWebhookCron } from './jira-webhook.cron';
import { JiraService } from './jira.service';

describe('JiraWebhookCron', () => {
  let cron: JiraWebhookCron;
  let jiraService: jest.Mocked<JiraService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraWebhookCron,
        {
          provide: JiraService,
          useValue: {
            refreshAllWebhooks: jest.fn(),
          },
        },
      ],
    }).compile();

    cron = module.get(JiraWebhookCron);
    jiraService = module.get(JiraService);
  });

  it('should be defined', () => {
    expect(cron).toBeDefined();
  });

  it('should call refreshAllWebhooks when invoked', async () => {
    jiraService.refreshAllWebhooks.mockResolvedValue(undefined);

    await cron.handleWebhookRefresh();

    expect(jiraService.refreshAllWebhooks).toHaveBeenCalledTimes(1);
  });

  it('propagates a refresh failure (one-shot K8s Job must exit non-zero)', async () => {
    // The old always-on daemon swallowed failures with a warn log; as a
    // one-shot CronJob pod the failure must reach the entrypoint so the
    // process exits 1 and the Job's backoffLimit retries it.
    jiraService.refreshAllWebhooks.mockRejectedValue(
      new Error('refresh failed'),
    );

    await expect(cron.handleWebhookRefresh()).rejects.toThrow('refresh failed');
  });
});
