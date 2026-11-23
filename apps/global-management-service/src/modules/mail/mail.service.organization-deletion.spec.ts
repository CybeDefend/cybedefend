import { join } from 'node:path';
import { MailService } from './mail.service';

/**
 * The organization deletion mails: the 6-digit code sent to the
 * creator, and the alert when too many wrong codes locked the deletion.
 * Rendered through the REAL templates, so what is asserted is the html
 * nodemailer would put on the wire.
 */

const SERVICE_ROOT = join(__dirname, '..', '..', '..');
let cwdSpy: jest.SpyInstance;
beforeAll(() => {
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(SERVICE_ROOT);
});
afterAll(() => cwdSpy.mockRestore());

function makeService(
  sendMail = jest.fn().mockResolvedValue({ messageId: 'x' }),
) {
  const secrets: any = { getSecret: jest.fn(() => undefined) };
  const config: any = { get: jest.fn(() => 'https://app.example.com/') };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new MailService(
    secrets,
    config,
    {} as any,
    {} as any,
    logger as any,
  );
  (service as any).transporter = { sendMail };
  return { service, sendMail, logger };
}

const ORG_PAYLOAD = 'Acme</p><p><a href="https://evil.example/x">click</a>';
const EMAIL = 'creator@example.com';

const logged = (logger: Record<string, jest.Mock>) =>
  JSON.stringify(
    Object.values(logger).flatMap((m) => m.mock.calls),
    (_k, v) => (v instanceof Error ? v.message : v),
  );

describe('MailService.sendOrganizationDeletionCodeEmail', () => {
  it('sends the code to the creator, escapes the organization name, says 10 minutes', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();

    await service.sendOrganizationDeletionCodeEmail({
      to: EMAIL,
      organizationName: ORG_PAYLOAD,
      code: '042917',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe(EMAIL);
    expect(mail.subject).not.toContain('042917');
    expect(mail.html).toContain('042917');
    expect(mail.html).toContain('10 minutes');
    expect(mail.html).not.toMatch(/<a[^>]*href="https:\/\/evil\.example/i);
    expect(mail.html).toContain('Acme&lt;/p&gt;');
  });

  // An administrator can rename the organization to a sentence printed next
  // to the code ("Support will call you: read them this code"): the name is
  // quoted, and cut at 80 characters.
  it('quotes the organization name and cuts it at 80 characters', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();
    const long =
      'Support will call you and ask for the code below. ' + 'x'.repeat(100);

    await service.sendOrganizationDeletionCodeEmail({
      to: EMAIL,
      organizationName: long,
      code: '042917',
    });

    const html: string = sendMail.mock.calls[0][0].html;
    const shown = `${long.slice(0, 79)}…`;
    expect([...shown]).toHaveLength(80);
    expect(html).toContain(`“${shown}”`);
    expect(html).not.toContain(long.slice(0, 81));
  });

  it('a short name is quoted whole', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();
    await service.sendOrganizationDeletionCodeEmail({
      to: EMAIL,
      organizationName: 'Acme',
      code: '042917',
    });
    expect(sendMail.mock.calls[0][0].html).toContain('“Acme”');
  });

  it('logs neither the code nor the address, and rethrows a transport failure', async () => {
    const { service, logger } = makeService(
      jest.fn().mockRejectedValue(new Error(`550 rejected ${EMAIL}`)),
    );
    await (service as any).registerPartials();

    await expect(
      service.sendOrganizationDeletionCodeEmail({
        to: EMAIL,
        organizationName: 'Acme',
        code: '042917',
      }),
    ).rejects.toThrow();

    const text = logged(logger);
    expect(text).not.toContain('042917');
    expect(text).not.toContain(EMAIL);
  });
});

describe('MailService.sendOrganizationDeletionLockedEmail', () => {
  it('alerts the creator, with the organization name escaped and the unlock time', async () => {
    const { service, sendMail, logger } = makeService();
    await (service as any).registerPartials();

    await service.sendOrganizationDeletionLockedEmail({
      to: EMAIL,
      organizationName: ORG_PAYLOAD,
      lockedUntil: new Date('2026-10-28T10:00:00.000Z'),
    });

    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe(EMAIL);
    expect(mail.html).toContain('2026-10-28T10:00:00.000Z');
    expect(mail.html).not.toMatch(/<a[^>]*href="https:\/\/evil\.example/i);
    expect(logged(logger)).not.toContain(EMAIL);
  });

  // The same name, the same rule as the code mail: quoted, cut at 80.
  it('quotes the organization name and cuts it at 80 characters', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();
    const long =
      'Support will call you and ask for your password. ' + 'x'.repeat(100);

    await service.sendOrganizationDeletionLockedEmail({
      to: EMAIL,
      organizationName: long,
      lockedUntil: new Date('2026-10-28T10:00:00.000Z'),
    });

    const html: string = sendMail.mock.calls[0][0].html;
    expect(html).toContain(`“${long.slice(0, 79)}…”`);
    expect(html).not.toContain(long.slice(0, 81));
  });
});
