import { MailService } from './mail.service';

/**
 * the consolidated report emails must thread the vulnerability
 * `branch` into the template context:
 *  - daily critical: hybrid grouping (inline header vs per-branch sections);
 *  - weekly / monthly: a per-row branch on each top-recent entry.
 *
 * I/O is mocked exactly like mail.service.consolidated.spec.ts; we assert on the
 * context handed to `compileTemplate`.
 */
function makeService(): {
  svc: MailService;
  compile: jest.Mock;
} {
  const configMock = {
    get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.example.com' : ''),
  } as any;
  const svc = new MailService(
    {} as any,
    configMock,
    {} as any,
    {} as any,
    { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
  );
  (svc as any).transporter = {
    sendMail: jest.fn().mockResolvedValue(undefined),
  };
  const compile = jest
    .spyOn(svc as any, 'render')
    .mockResolvedValue('<html></html>') as unknown as jest.Mock;
  jest.spyOn(svc as any, 'fetchProjectAccessPairs').mockResolvedValue([
    {
      userId: 'u1',
      email: 'ann@x.io',
      firstName: 'Ann',
      notification: true,
      projectId: 'p1',
    },
  ]);
  return { svc, compile };
}

const crit = (branch: string | undefined, title: string) => ({
  severity: 'critical',
  title,
  type: 'SCA',
  branch,
});

describe('sendConsolidatedDailyCriticalReportEmail — branch grouping', () => {
  it('splits a multi-branch project into per-branch sections in the context', async () => {
    const { svc, compile } = makeService();

    await svc.sendConsolidatedDailyCriticalReportEmail({
      organizationId: 'org-1',
      projects: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          count: 3,
          criticals: [crit('main', 'a'), crit('dev', 'b'), crit('main', 'c')],
        },
      ],
    } as any);

    const context = compile.mock.calls[0][1] as any;
    const proj = context.projects[0];
    expect(proj.multiBranch).toBe(true);
    expect(proj.branches.map((b: any) => b.branch).sort()).toEqual([
      'dev',
      'main',
    ]);
  });

  it('shows a single-branch project inline (branch on the project, flat list)', async () => {
    const { svc, compile } = makeService();

    await svc.sendConsolidatedDailyCriticalReportEmail({
      organizationId: 'org-1',
      projects: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          count: 2,
          criticals: [crit('main', 'a'), crit('main', 'b')],
        },
      ],
    } as any);

    const context = compile.mock.calls[0][1] as any;
    const proj = context.projects[0];
    expect(proj.multiBranch).toBe(false);
    expect(proj.branch).toBe('main');
    expect(proj.vulnerabilities).toHaveLength(2);
  });
});

describe('sendConsolidatedWeeklyReportEmail — per-row branch', () => {
  it('carries the branch onto each top-recent vulnerability in the context', async () => {
    const { svc, compile } = makeService();

    await svc.sendConsolidatedWeeklyReportEmail({
      organizationId: 'org-1',
      projects: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          severities: { critical: 1, high: 0, medium: 0, low: 0 },
          total: 1,
          topRecent: [
            {
              severity: 'critical',
              title: 'x',
              type: 'SCA',
              packageName: 'redis',
              version: '6.2.0',
              branch: 'main',
            },
          ],
        },
      ],
    } as any);

    const context = compile.mock.calls[0][1] as any;
    expect(context.projects[0].vulnerabilities[0].branch).toBe('main');
  });
});
