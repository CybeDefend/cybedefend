import { MailService } from './mail.service';

/**
 * The mail service logs through the service logger only (never the
 * console), and no line it writes carries a recipient address: a log is
 * shipped and kept far longer than a mail, and an address is personal data.
 * A nodemailer error repeats the recipient in its message, so a failure is
 * logged by the error's class, not by the error itself.
 */

const EMAIL = 'ann.recipient@example.org';
const LOCAL_PART = 'ann.recipient';

const consoleSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  for (const m of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    consoleSpies.push(jest.spyOn(console, m).mockImplementation(() => {}));
  }
});
afterEach(() => {
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
});

function makeService(fail = false) {
  const transportError = Object.assign(
    new Error(`Can't send mail - all recipients were rejected: <${EMAIL}>`),
    { name: 'SendMailError' },
  );
  const sendMail = fail
    ? jest.fn().mockRejectedValue(transportError)
    : jest.fn().mockResolvedValue({ messageId: 'x' });
  const config: any = {
    get: jest.fn((k: string) =>
      k === 'EMAIL_FROM' ? 'noreply@example.com' : 'https://app.example.com',
    ),
  };
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };
  const service = new MailService(
    { getSecret: jest.fn() } as any,
    config,
    {} as any,
    {} as any,
    logger as any,
  );
  (service as any).transporter = { sendMail };
  jest.spyOn(service as any, 'render').mockResolvedValue('<html></html>');
  jest
    .spyOn(service, 'resolveOrganizationCreatorName')
    .mockResolvedValue('Ann');
  jest.spyOn(service as any, 'fetchProjectAccessPairs').mockResolvedValue([
    {
      userId: 'u1',
      email: EMAIL,
      firstName: 'Ann',
      notification: true,
      projectId: 'p1',
    },
  ]);
  return { service, logger };
}

const vuln = {
  id: 'v1',
  title: 't',
  severity: 'critical',
  type: 'sast',
  state: 'to_verify',
  createdAt: '2026-01-01T00:00:00Z',
};
const severities = { critical: 1, high: 0, medium: 0, low: 0 };
const types = { sast: 1, iac: 0, sca: 0, container: 0 };

const SENDS: Array<[string, (s: MailService) => Promise<unknown>]> = [
  ['welcome', (s) => s.sendWelcomeEmail(EMAIL, 'Ann')],
  [
    'invitation',
    (s) =>
      s.sendOrganizationInviteEmail({
        token: 't',
        email: EMAIL,
        organizationName: 'Acme',
        organizationRole: 'user',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      } as any),
  ],
  [
    'weekly project report',
    (s) =>
      s.sendWeeklyProjectReportEmail({
        projectId: 'p1',
        projectName: 'web',
        severities,
        types,
        topRecent: [vuln],
        total: 1,
        newLast7d: 1,
        resolvedLast7d: 0,
        recipients: [EMAIL],
      }),
  ],
  [
    'monthly project report',
    (s) =>
      s.sendMonthlyProjectReportEmail({
        projectId: 'p1',
        projectName: 'web',
        severities,
        types,
        topRecent: [vuln],
        total: 1,
        recipients: [EMAIL],
      } as any),
  ],
  [
    'daily critical alerts',
    (s) =>
      s.sendDailyCriticalAlertsEmail({
        projectId: 'p1',
        projectName: 'web',
        criticals: [vuln],
        recipients: [EMAIL],
      } as any),
  ],
  [
    'scan complete report',
    (s) =>
      s.sendScanCompleteReportEmail({
        projectId: 'p1',
        projectName: 'web',
        scanId: 's1',
        severities,
        types,
        total: 1,
        topVulnerabilities: [vuln],
        scannerType: 'sast',
        recipients: [EMAIL],
      }),
  ],
  [
    'consolidated weekly report',
    (s) =>
      s.sendConsolidatedWeeklyReportEmail({
        organizationId: 'o1',
        projects: [
          {
            projectId: 'p1',
            projectName: 'web',
            severities,
            total: 1,
            topRecent: [],
          },
        ],
      }),
  ],
  [
    'consolidated daily critical report',
    (s) =>
      s.sendConsolidatedDailyCriticalReportEmail({
        organizationId: 'o1',
        projects: [
          {
            projectId: 'p1',
            projectName: 'web',
            criticals: [vuln],
            count: 1,
          },
        ],
      }),
  ],
];

function written(logger: Record<string, jest.Mock>): string {
  return JSON.stringify(
    Object.values(logger).flatMap((m) => m.mock.calls),
    (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v),
  );
}

describe('MailService log hygiene', () => {
  it.each(SENDS)(
    '%s: logs through the logger, with no recipient address',
    async (_name, send) => {
      const { service, logger } = makeService();
      await send(service);

      expect(written(logger)).not.toContain(LOCAL_PART);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(SENDS)(
    '%s: a transport failure is logged without the recipient address',
    async (_name, send) => {
      const { service, logger } = makeService(true);
      await send(service).catch(() => undefined);

      const text = written(logger);
      expect(text).not.toContain(LOCAL_PART);
      expect(text).toContain('SendMailError');
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    },
  );

  it('a report with no recipient is logged through the logger', async () => {
    const { service, logger } = makeService();
    jest.spyOn(service, 'resolveOrganizationEmail').mockResolvedValue(null);

    await service.sendScanCompleteReportEmail({
      projectId: 'p1',
      projectName: 'web',
      scanId: 's1',
      severities,
      types,
      total: 1,
      topVulnerabilities: [vuln],
    } as any);

    expect(logger.warn).toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
