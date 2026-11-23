import { of, throwError } from 'rxjs';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Logger } from 'nestjs-pino';
import { ReportMailCron } from './report-mail.cron';
import type { ReportAggregationService } from './report-aggregation.service';
import type { AnalysisReportingEntitlementsPort } from 'src/edition/ports/entitlements.port';

/**
 * The daily, weekly and monthly reports (e-mail and Slack) leave out the
 * findings of a branch the customer archived. The cron reads each project's
 * archived branches from global-management and hands them to the
 * aggregation; a failed read reports every branch, as before, with a warning.
 */
describe('ReportMailCron — archived branches', () => {
  const project = (projectId: string) => ({
    projectId,
    name: `name-${projectId}`,
    organizationId: 'org-1',
    weeklyReportEnabled: true,
    monthlyReportEnabled: true,
    emailAlertEnabled: true,
    weeklyReportSlackEnabled: true,
    monthlyReportSlackEnabled: true,
  });
  const agg = (projectId: string, projectName: string) => ({
    projectId,
    projectName,
    severities: {},
    types: {},
    topRecent: [],
    total: 0,
    criticals: [],
  });
  let logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let aggregation: Record<string, jest.Mock>;
  let getArchivedBranches: jest.Mock;
  let cron: ReportMailCron;

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
    const archivedOf: Record<string, string[]> = {
      p1: ['release/1.0'],
      p2: [],
    };
    getArchivedBranches = jest.fn(({ projectId }: { projectId: string }) =>
      of({ branches: archivedOf[projectId] ?? [] }),
    );
    const getAllProjects = jest.fn(() =>
      of({ projects: [project('p1'), project('p2')], totalPages: 1 }),
    );
    const mail = {
      sendConsolidatedWeeklyReport: jest.fn(() => of({})),
      sendConsolidatedMonthlyReport: jest.fn(() => of({})),
      sendConsolidatedDailyCriticalReport: jest.fn(() => of({})),
    };
    const gm = {
      getService: (name: string) =>
        name === 'MailReportService'
          ? mail
          : { getAllProjects, getArchivedBranches },
    } as unknown as ClientGrpc;
    const ei = {
      getService: () => ({ sendNotification: jest.fn(() => of({})) }),
    } as unknown as ClientGrpc;
    const entitlements = {
      getProductsForOrganizations: jest.fn(async () => ({
        off: new Set<string>(),
        failed: false,
      })),
    };
    cron = new ReportMailCron(
      logger as unknown as Logger,
      aggregation as unknown as ReportAggregationService,
      gm,
      ei,
      entitlements as unknown as AnalysisReportingEntitlementsPort,
    );
    cron.onModuleInit();
  });

  const archivedPassedFor = (m: jest.Mock, projectId: string) => {
    const call = m.mock.calls.find((c) => c[0] === projectId);
    return [...(call?.[2] ?? [])].sort();
  };

  it.each([
    ['weekly', 'runWeekly', 'aggregateWeekly'],
    ['monthly', 'runMonthly', 'aggregateMonthly'],
    ['daily', 'runDailyCritical', 'aggregateDailyCritical'],
  ] as const)(
    '%s: hands each project its archived branches',
    async (_label, run, aggregate) => {
      await cron[run]();

      expect(getArchivedBranches).toHaveBeenCalledWith({ projectId: 'p1' });
      expect(archivedPassedFor(aggregation[aggregate], 'p1')).toEqual([
        'release/1.0',
      ]);
      expect(archivedPassedFor(aggregation[aggregate], 'p2')).toEqual([]);
    },
  );

  it('reports every branch, with a warning, when the archived branches cannot be read', async () => {
    getArchivedBranches.mockImplementation(() =>
      throwError(() => new Error('14 UNAVAILABLE')),
    );

    await cron.runWeekly();

    expect(aggregation.aggregateWeekly).toHaveBeenCalledTimes(2);
    expect(archivedPassedFor(aggregation.aggregateWeekly, 'p1')).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('archived branches'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('14 UNAVAILABLE'),
    );
  });
});
