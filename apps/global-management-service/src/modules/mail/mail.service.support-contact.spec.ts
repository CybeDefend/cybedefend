import { join } from 'node:path';
import { MailService } from './mail.service';
import type { SupportContact } from 'src/edition/ports/support-contact.port';

/**
 * Who a mail tells its reader to contact comes from the edition
 * (SUPPORT_CONTACT_PORT). A self-hosted instance is run by its own
 * administrator: by default no mail names a vendor mailbox.
 */

const SERVICE_ROOT = join(__dirname, '..', '..', '..');
let cwdSpy: jest.SpyInstance;
beforeAll(() => {
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(SERVICE_ROOT);
});
afterAll(() => cwdSpy.mockRestore());

function makeService(supportContact?: SupportContact) {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
  const secrets: any = { getSecret: jest.fn(() => undefined) };
  const config: any = { get: jest.fn(() => 'https://app.example.com/') };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new MailService(
    secrets,
    config,
    {} as any,
    {} as any,
    logger as any,
    supportContact,
  );
  (service as any).transporter = { sendMail };
  return { service, sendMail };
}

const MAILBOX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

async function welcomeHtml(contact?: SupportContact): Promise<string> {
  const { service, sendMail } = makeService(contact);
  await (service as any).registerPartials();
  await service.sendWelcomeEmail('new@example.com', 'Ann');
  return sendMail.mock.calls[0][0].html;
}

async function lockedHtml(contact?: SupportContact): Promise<string> {
  const { service, sendMail } = makeService(contact);
  await (service as any).registerPartials();
  await service.sendOrganizationDeletionLockedEmail({
    to: 'creator@example.com',
    organizationName: 'Acme',
    lockedUntil: new Date('2030-01-01T00:00:00Z'),
  });
  return sendMail.mock.calls[0][0].html;
}

describe('MailService: the support contact', () => {
  it('the welcome mail sends a question to the instance administrator, naming no mailbox', async () => {
    const html = await welcomeHtml();
    expect(html).toContain('administrator of your CybeDefend instance');
    expect(html).not.toMatch(MAILBOX);
  });

  it('the deletion-locked alert sends the reader to the instance administrator, naming no mailbox', async () => {
    const html = await lockedHtml();
    expect(html).toContain(
      'change your password and contact the administrator',
    );
    expect(html).not.toMatch(MAILBOX);
  });

  it('prints the contact the edition binds', async () => {
    const contact: SupportContact = {
      questionLine: () => 'Questions go to the help desk.',
      compromisedAccountContact: () => 'the help desk',
    };
    expect(await welcomeHtml(contact)).toContain(
      'Questions go to the help desk.',
    );
    expect(await lockedHtml(contact)).toContain(
      'change your password and contact the help desk.',
    );
  });
});
