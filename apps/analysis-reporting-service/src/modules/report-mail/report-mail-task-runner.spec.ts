import { runReportMailTask } from './report-mail-task-runner';

describe('runReportMailTask', () => {
  let cron: {
    runWeekly: jest.Mock;
    runMonthly: jest.Mock;
    runDailyCritical: jest.Mock;
  };

  beforeEach(() => {
    cron = {
      runWeekly: jest.fn().mockResolvedValue(undefined),
      runMonthly: jest.fn().mockResolvedValue(undefined),
      runDailyCritical: jest.fn().mockResolvedValue(undefined),
    };
  });

  it("runs the weekly report for task 'weekly'", async () => {
    await runReportMailTask(cron as any, 'weekly');

    expect(cron.runWeekly).toHaveBeenCalledTimes(1);
    expect(cron.runMonthly).not.toHaveBeenCalled();
    expect(cron.runDailyCritical).not.toHaveBeenCalled();
  });

  it("runs the monthly report for task 'monthly'", async () => {
    await runReportMailTask(cron as any, 'monthly');

    expect(cron.runMonthly).toHaveBeenCalledTimes(1);
    expect(cron.runWeekly).not.toHaveBeenCalled();
    expect(cron.runDailyCritical).not.toHaveBeenCalled();
  });

  it("runs the daily critical alerts for task 'daily'", async () => {
    await runReportMailTask(cron as any, 'daily');

    expect(cron.runDailyCritical).toHaveBeenCalledTimes(1);
    expect(cron.runWeekly).not.toHaveBeenCalled();
    expect(cron.runMonthly).not.toHaveBeenCalled();
  });

  it('throws on an unknown task, listing the valid ones', async () => {
    await expect(runReportMailTask(cron as any, 'hourly')).rejects.toThrow(
      /weekly, monthly, daily/,
    );
    expect(cron.runWeekly).not.toHaveBeenCalled();
    expect(cron.runMonthly).not.toHaveBeenCalled();
    expect(cron.runDailyCritical).not.toHaveBeenCalled();
  });

  it('throws when the task is missing (CRON_TASK unset)', async () => {
    await expect(runReportMailTask(cron as any, undefined)).rejects.toThrow(
      /CRON_TASK/,
    );
  });

  it('propagates the task failure (job must exit non-zero for K8s backoff)', async () => {
    cron.runDailyCritical.mockRejectedValueOnce(new Error('grpc down'));

    await expect(runReportMailTask(cron as any, 'daily')).rejects.toThrow(
      'grpc down',
    );
  });
});
