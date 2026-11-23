import { cronModuleKind, runCronTask } from './cron-task-runner';

describe('runCronTask', () => {
  let jiraWebhookCron: { handleWebhookRefresh: jest.Mock };

  beforeEach(() => {
    jiraWebhookCron = {
      handleWebhookRefresh: jest.fn().mockResolvedValue(undefined),
    };
  });

  it("runs the Jira webhook refresh for task 'jira-webhook-refresh'", async () => {
    await runCronTask({ jiraWebhookCron } as any, 'jira-webhook-refresh');

    expect(jiraWebhookCron.handleWebhookRefresh).toHaveBeenCalledTimes(1);
  });

  it('throws on an unknown task, listing the valid ones', async () => {
    await expect(
      runCronTask({ jiraWebhookCron } as any, 'hourly'),
    ).rejects.toThrow(/jira-webhook-refresh/);
    expect(jiraWebhookCron.handleWebhookRefresh).not.toHaveBeenCalled();
  });

  it('throws when the task is missing (CRON_TASK unset)', async () => {
    await expect(
      runCronTask({ jiraWebhookCron } as any, undefined),
    ).rejects.toThrow(/CRON_TASK/);
  });

  it('propagates the task failure (job must exit non-zero for K8s backoff)', async () => {
    jiraWebhookCron.handleWebhookRefresh.mockRejectedValueOnce(
      new Error('atlassian 502'),
    );

    await expect(
      runCronTask({ jiraWebhookCron } as any, 'jira-webhook-refresh'),
    ).rejects.toThrow('atlassian 502');
  });

  describe("task 'gitlab-webhook-token-migration'", () => {
    it('runs the GitLab webhook token migration', async () => {
      const gitlabWebhookTokenMigration = {
        run: jest.fn().mockResolvedValue({ remaining: 0 }),
      };

      await runCronTask(
        { gitlabWebhookTokenMigration } as any,
        'gitlab-webhook-token-migration',
      );

      expect(gitlabWebhookTokenMigration.run).toHaveBeenCalledTimes(1);
    });

    it('loads its own module, so the Jira refresh keeps its light one', () => {
      expect(cronModuleKind('gitlab-webhook-token-migration')).toBe('gitlab');
      expect(cronModuleKind('jira-webhook-refresh')).toBe('webhook');
      expect(cronModuleKind(undefined)).toBe('webhook');
    });

    it('fails clearly when its dependency was not loaded', async () => {
      await expect(
        runCronTask({} as any, 'gitlab-webhook-token-migration'),
      ).rejects.toThrow(/gitlabWebhookTokenMigration/);
    });
  });
});
