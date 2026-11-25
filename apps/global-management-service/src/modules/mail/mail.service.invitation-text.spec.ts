import { join } from 'node:path';
import { MailService } from './mail.service';
import {
  INVITATION_ORGANIZATION_NAME_MAX,
  INVITATION_SUBJECT,
} from './invitation-text';

/**
 * The invitation e-mail goes to an address the inviter chooses, under the
 * instance's sender, and carries an organisation name its creator chose
 * freely. These render the REAL templates and read what nodemailer would
 * send: the name is plain, short, quoted text that no mail client turns
 * into a link, and the subject carries none of it.
 */
const SERVICE_ROOT = join(__dirname, '..', '..', '..');
let cwdSpy: jest.SpyInstance;

beforeAll(() => {
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(SERVICE_ROOT);
});
afterAll(() => {
  cwdSpy.mockRestore();
});

const ZWSP = '​';

async function invitationMail(
  organizationName: string,
): Promise<{ html: string; subject: string; text: string }> {
  const secrets = { getSecret: jest.fn(() => undefined) };
  const config = { get: jest.fn(() => 'https://app.example.com/') };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new MailService(
    secrets as never,
    config as never,
    {} as never,
    {} as never,
    logger as never,
  );
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
  // Bypass onModuleInit: it would build a real SMTP transport and verify it.
  (service as unknown as { transporter: unknown }).transporter = { sendMail };
  await (
    service as unknown as { registerPartials: () => Promise<void> }
  ).registerPartials();
  await service.sendOrganizationInviteEmail({
    id: 'i1',
    token: 'tok',
    email: 'invitee@example.com',
    status: 'pending',
    organizationId: 'o1',
    organizationName,
    organizationRole: 'member',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  expect(sendMail).toHaveBeenCalledTimes(1);
  const { html, subject } = sendMail.mock.calls[0][0] as {
    html: string;
    subject: string;
  };
  // What a reader sees: the markup without the link targets, which carry
  // the organisation percent-encoded for the invitation page.
  const text = html.replace(/href="[^"]*"/g, '');
  return { html, subject, text };
}

describe('invitation e-mail: the organisation name is inert text', () => {
  it('the subject is fixed text, without the organisation name', async () => {
    const { subject } = await invitationMail('Acme - verify your account');

    expect(subject).toBe(INVITATION_SUBJECT);
    expect(subject).not.toContain('Acme');
  });

  it('the title carries no free text', async () => {
    const { html } = await invitationMail('Acme Security Team');
    const title = html.slice(html.indexOf('<h1'), html.indexOf('</h1>'));

    expect(title).not.toContain('Acme');
  });

  it('no part of the name can become a link', async () => {
    const { text } = await invitationMail(
      'Sign in at https://evil.example/login or mail help@evil.example',
    );

    expect(text).not.toContain('evil.example');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('help@evil');
    expect(text).toContain(`evil.${ZWSP}example`);
  });

  it.each([
    ['ideographic full stop', 'evil。example'],
    ['fullwidth full stop', 'evil．example'],
    ['halfwidth ideographic full stop', 'evil｡example'],
    ['one dot leader', 'evil․example'],
    ['small full stop', 'evil﹒example'],
    ['fullwidth commercial at', 'help＠evil'],
    ['small commercial at', 'help﹫evil'],
    ['fullwidth solidus', 'evil／path'],
    ['fullwidth colon', 'evil：path'],
  ])('a look-alike %s is broken too', async (_label, name) => {
    const { text } = await invitationMail(name);
    const [left, right] = [name.slice(0, 4), name.slice(5, 9)];
    const lookAlike = name[4];

    expect(text).toContain(`${left}${lookAlike}${ZWSP}${right}`);
    expect(text).not.toContain(name);
  });

  it('control and invisible characters are removed and the name is quoted', async () => {
    const { text } = await invitationMail(
      'Acme‮gnp​\r\nDear user, your account is locked',
    );

    expect(text).not.toMatch(/[‮\r]/u);
    expect(text).toContain('“Acme gnp Dear user, your account is locked”');
  });

  it('a long name is cut', async () => {
    const long = 'A'.repeat(500);
    const { text } = await invitationMail(long);

    expect(text).not.toContain('A'.repeat(INVITATION_ORGANIZATION_NAME_MAX));
    expect(text).toContain(
      `“${'A'.repeat(INVITATION_ORGANIZATION_NAME_MAX - 1)}…”`,
    );
  });
});
