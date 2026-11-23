import { MailService } from './mail.service';

/**
 * Orchestration test for the consolidated weekly report: one email per
 * recipient, each carrying only their accessible subset, gated by the pure
 * resolver (which is unit-tested separately in report-recipients.spec.ts).
 *
 * I/O is mocked: the DB access-pair fetch and the template compile are stubbed,
 * and the nodemailer transporter is replaced with a spy.
 */
function makeService(): MailService {
  const configMock = {
    get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.example.com' : ''),
  } as any;
  const svc = new MailService(
    {} as any, // secretsService
    configMock,
    {} as any, // organizationRepo
    {} as any, // projectRepo
    { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any, // logger
  );
  (svc as any).transporter = {
    sendMail: jest.fn().mockResolvedValue(undefined),
  };
  jest.spyOn(svc as any, 'render').mockResolvedValue('<html></html>');
  return svc;
}

const sev = (critical: number) => ({ critical, high: 0, medium: 0, low: 0 });
const project = (id: string, name: string, total: number) => ({
  projectId: id,
  projectName: name,
  severities: sev(total),
  types: { sast: 0, iac: 0, sca: 0, container: 0 },
  topRecent: [],
  total,
  newLast7d: 0,
  resolvedLast7d: 0,
});

describe('sendConsolidatedWeeklyReportEmail', () => {
  it('sends one email per recipient containing only their accessible subset', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'fetchProjectAccessPairs').mockResolvedValue([
      {
        userId: 'u1',
        email: 'ann@x.io',
        firstName: 'Ann',
        notification: true,
        projectId: 'p1',
      },
      {
        userId: 'u2',
        email: 'bob@x.io',
        firstName: 'Bob',
        notification: true,
        projectId: 'p2',
      },
    ]);

    await svc.sendConsolidatedWeeklyReportEmail({
      organizationId: 'org-1',
      projects: [project('p1', 'Alpha', 3), project('p2', 'Beta', 2)],
    });

    const sendMail = (svc as any).transporter.sendMail as jest.Mock;
    expect(sendMail).toHaveBeenCalledTimes(2);
    const byTo = Object.fromEntries(
      sendMail.mock.calls.map(([opts]) => [opts.to, opts]),
    );
    expect(byTo['ann@x.io'].subject).toContain("Ann's Weekly Security Report");
    expect(byTo['bob@x.io'].subject).toContain("Bob's Weekly Security Report");
  });

  it('does not send when no recipient is eligible (e.g. all notifications off)', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'fetchProjectAccessPairs').mockResolvedValue([
      {
        userId: 'u1',
        email: 'ann@x.io',
        firstName: 'Ann',
        notification: false,
        projectId: 'p1',
      },
    ]);

    await svc.sendConsolidatedWeeklyReportEmail({
      organizationId: 'org-1',
      projects: [project('p1', 'Alpha', 3)],
    });

    expect((svc as any).transporter.sendMail).not.toHaveBeenCalled();
  });

  it('skips projects with zero vulnerabilities before resolving recipients', async () => {
    const svc = makeService();
    const fetchSpy = jest
      .spyOn(svc as any, 'fetchProjectAccessPairs')
      .mockResolvedValue([]);

    await svc.sendConsolidatedWeeklyReportEmail({
      organizationId: 'org-1',
      projects: [project('p1', 'Alpha', 0)],
    });

    // all projects empty -> nothing to do, no DB lookup, no mail
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((svc as any).transporter.sendMail).not.toHaveBeenCalled();
  });
});
