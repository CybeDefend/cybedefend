import { of } from 'rxjs';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Logger } from 'nestjs-pino';
import { ReportMailCron } from './report-mail.cron';
import type { ReportAggregationService } from './report-aggregation.service';
import type { AnalysisReportingEntitlementsPort } from 'src/edition/ports/entitlements.port';

/**
 * The weekly, monthly and daily AppSec
 * reports (consolidated e-mails and per-project Slack) skip every
 * organisation whose AppSec is off. The products are read once per run, in
 * batches; a failed read sends as before, with one warning per run.
 */
describe('ReportMailCron — organisations whose AppSec is off', () => {
  const project = (projectId: string, organizationId: string) => ({
    projectId,
    name: `name-${projectId}`,
    organizationId,
    weeklyReportEnabled: true,
    monthlyReportEnabled: true,
    emailAlertEnabled: true,
    weeklyReportSlackEnabled: true,
    monthlyReportSlackEnabled: true,
  });
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let aggregation: Record<string, jest.Mock>;
  let mail: Record<string, jest.Mock>;
  let slack: { sendNotification: jest.Mock };
  let entitlements: { getProductsForOrganizations: jest.Mock };
  let getAllProjects: jest.Mock;
  let cron: ReportMailCron;

  const agg = (projectId: string, projectName: string) => ({
    projectId,
    projectName,
    severities: {},
    types: {},
    topRecent: [],
    total: 3,
    newLast7d: 1,
    resolvedLast7d: 0,
    newLast30d: 1,
    resolvedLast30d: 0,
    criticals: [
      {
        id: 'v1',
        type: 'SAST',
        title: 't',
        severity: 'critical',
        state: 'to_verify',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  });

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    aggregation = {
      aggregateWeekly: jest.fn(async (id: string, name: string) =>
        agg(id, name),
      ),
      aggregateMonthly: jest.fn(async (id: string, name: string) =>
        agg(id, name),
      ),
      aggregateDailyCritical: jest.fn(async (id: string, name: string) =>
        agg(id, name),
      ),
    };
    mail = {
      sendConsolidatedWeeklyReport: jest.fn(() => of({})),
      sendConsolidatedMonthlyReport: jest.fn(() => of({})),
      sendConsolidatedDailyCriticalReport: jest.fn(() => of({})),
    };
    slack = { sendNotification: jest.fn(() => of({})) };
    getAllProjects = jest.fn(() =>
      of({
        projects: [
          project('p-on', 'org-on'),
          project('p-off', 'org-off'),
          project('p-unpaid', 'org-unpaid'),
          project('p-never', 'org-never'),
          project('p-trial', 'org-trial-exhausted'),
          project('p-none', ''),
        ],
        totalPages: 1,
      }),
    );
    // Deactivated, never activated and unpaid are off; a trial whose
    // counters are used up is read-only, not off: its reports still go out.
    const offOrgs = new Set(['org-off', 'org-never', 'org-unpaid']);
    entitlements = {
      getProductsForOrganizations: jest.fn(async (ids: Iterable<string>) => ({
        off: new Set([...ids].filter((id) => offOrgs.has(id))),
        failed: false,
      })),
    };
    const gm = {
      getService: (name: string) =>
        name === 'MailReportService'
          ? mail
          : {
              getAllProjects,
              getArchivedBranches: () => of({ branches: [] }),
            },
    } as unknown as ClientGrpc;
    const ei = { getService: () => slack } as unknown as ClientGrpc;
    cron = new ReportMailCron(
      logger as unknown as Logger,
      aggregation as unknown as ReportAggregationService,
      gm,
      ei,
      entitlements as unknown as AnalysisReportingEntitlementsPort,
    );
    cron.onModuleInit();
  });

  const mailedOrgs = (m: jest.Mock) =>
    m.mock.calls.map((c) => c[0].organizationId).sort();
  const slackedProjects = () =>
    slack.sendNotification.mock.calls.map((c) => c[0].projectId).sort();
  const aggregated = (m: jest.Mock) => m.mock.calls.map((c) => c[0]).sort();

  it('weekly: no e-mail, no Slack and no aggregation for an organisation whose AppSec is off or unpaid', async () => {
    await cron.runWeekly();

    expect(mailedOrgs(mail.sendConsolidatedWeeklyReport)).toEqual([
      'org-on',
      'org-trial-exhausted',
    ]);
    expect(slackedProjects()).toEqual(['p-none', 'p-on', 'p-trial']);
    expect(aggregated(aggregation.aggregateWeekly)).toEqual([
      'p-none',
      'p-on',
      'p-trial',
    ]);
  });

  it('monthly: the same organisations are skipped', async () => {
    await cron.runMonthly();

    expect(mailedOrgs(mail.sendConsolidatedMonthlyReport)).toEqual([
      'org-on',
      'org-trial-exhausted',
    ]);
    expect(slackedProjects()).toEqual(['p-none', 'p-on', 'p-trial']);
  });

  it('daily critical: the same organisations are skipped', async () => {
    await cron.runDailyCritical();

    expect(mailedOrgs(mail.sendConsolidatedDailyCriticalReport)).toEqual([
      'org-on',
      'org-trial-exhausted',
    ]);
    expect(aggregated(aggregation.aggregateDailyCritical)).toEqual([
      'p-none',
      'p-on',
      'p-trial',
    ]);
  });

  it('reads the products once per run, every organisation in the same batch, never the empty id', async () => {
    await cron.runWeekly();

    expect(entitlements.getProductsForOrganizations).toHaveBeenCalledTimes(1);
    expect(
      [...entitlements.getProductsForOrganizations.mock.calls[0][0]].sort(),
    ).toEqual([
      'org-never',
      'org-off',
      'org-on',
      'org-trial-exhausted',
      'org-unpaid',
    ]);
  });

  it('billing down: every report goes out as before, with one warning for the run', async () => {
    // The entitlements port reports the unreadable products as failed.
    entitlements.getProductsForOrganizations.mockResolvedValue({
      off: new Set(),
      failed: true,
    });

    await cron.runWeekly();

    expect(mailedOrgs(mail.sendConsolidatedWeeklyReport)).toEqual([
      'org-never',
      'org-off',
      'org-on',
      'org-trial-exhausted',
      'org-unpaid',
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toEqual(
      expect.stringContaining('[WeeklyReportCron]'),
    );
  });
});
