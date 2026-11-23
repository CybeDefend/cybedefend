import { MailService } from './mail.service';

/**
 * A rejected SMTP credential, e.g.
 *
 *   Invalid login: 535-5.7.8 Username and Password not accepted (EAUTH)
 *
 * fails every recipient the same way. A per-recipient catch that logs and
 * moves on would report no failure to the caller and every report of the run
 * would be lost silently. It is not a per-recipient problem: it must abort the
 * run and surface, once.
 */
function makeService(
  logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
) {
  const configMock = {
    get: (k: string) => (k === 'FRONTEND_URL' ? 'https://app.example.com' : ''),
  } as any;
  const svc = new MailService(
    {} as any,
    configMock,
    {} as any,
    {} as any,
    logger as any,
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

const threeRecipients = [
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
  {
    userId: 'u3',
    email: 'cat@x.io',
    firstName: 'Cat',
    notification: true,
    projectId: 'p3',
  },
];
const threeProjects = [
  project('p1', 'Alpha', 3),
  project('p2', 'Beta', 2),
  project('p3', 'Gamma', 1),
];

const authError = () =>
  Object.assign(
    new Error('Invalid login: 535-5.7.8 Username and Password not accepted'),
    {
      code: 'EAUTH',
      responseCode: 535,
    },
  );

describe('consolidated report — SMTP transport failures', () => {
  it('aborts the run on rejected credentials instead of retrying per recipient', async () => {
    const svc = makeService();
    jest
      .spyOn(svc as any, 'fetchProjectAccessPairs')
      .mockResolvedValue(threeRecipients);
    const sendMail = (svc as any).transporter.sendMail as jest.Mock;
    sendMail.mockRejectedValue(authError());

    // The original nodemailer error is rethrown as-is, so `code` /
    // `responseCode` / stack survive for whoever handles it upstream.
    await expect(
      svc.sendConsolidatedWeeklyReportEmail({
        organizationId: 'org-1',
        projects: threeProjects,
      }),
    ).rejects.toMatchObject({ code: 'EAUTH', responseCode: 535 });

    // One attempt, not one per recipient: the credential is the problem.
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('still delivers to the other recipients when one address alone fails', async () => {
    const svc = makeService();
    jest
      .spyOn(svc as any, 'fetchProjectAccessPairs')
      .mockResolvedValue(threeRecipients);
    const sendMail = (svc as any).transporter.sendMail as jest.Mock;
    sendMail
      .mockRejectedValueOnce(
        Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 }),
      )
      .mockResolvedValue(undefined);

    await expect(
      svc.sendConsolidatedWeeklyReportEmail({
        organizationId: 'org-1',
        projects: threeProjects,
      }),
    ).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('states a partial loss once, at error level, with the counts', async () => {
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const svc = makeService(logger);
    jest
      .spyOn(svc as any, 'fetchProjectAccessPairs')
      .mockResolvedValue(threeRecipients);
    const sendMail = (svc as any).transporter.sendMail as jest.Mock;
    sendMail
      .mockRejectedValueOnce(
        Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 }),
      )
      .mockResolvedValue(undefined);

    await svc.sendConsolidatedWeeklyReportEmail({
      organizationId: 'org-1',
      projects: threeProjects,
    });

    const summary = logger.error.mock.calls
      .map((c) => c.map((a: unknown) => String(a)).join(' '))
      .find((m: string) => m.includes('1/3'));
    expect(summary).toBeDefined();
  });

  it('says nothing extra when every report goes out', async () => {
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const svc = makeService(logger);
    jest
      .spyOn(svc as any, 'fetchProjectAccessPairs')
      .mockResolvedValue(threeRecipients);

    await svc.sendConsolidatedWeeklyReportEmail({
      organizationId: 'org-1',
      projects: threeProjects,
    });

    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('verifyTransport', () => {
  it('reports rejected credentials at boot without taking the service down', async () => {
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const svc = makeService(logger);
    (svc as any).transporter.verify = jest.fn().mockRejectedValue(authError());

    // Must NOT throw: mail is one feature among many, and a crash-loop here
    // would take org/team/project management down with it.
    await expect((svc as any).verifyTransport()).resolves.toBeUndefined();

    const reported = logger.error.mock.calls
      .map((c) => c.map((a: unknown) => String(a)).join(' '))
      .join('\n');
    expect(reported).toMatch(/SMTP/i);
  });

  it('stays quiet when the credentials are good', async () => {
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const svc = makeService(logger);
    (svc as any).transporter.verify = jest.fn().mockResolvedValue(true);

    await (svc as any).verifyTransport();

    expect(logger.error).not.toHaveBeenCalled();
  });
});
