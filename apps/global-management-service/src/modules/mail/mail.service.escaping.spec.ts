import { join } from 'node:path';
import { MailService } from './mail.service';

/**
 * HTML injection into transactional mail bodies (CWE-79).
 *
 * These render the REAL Handlebars templates through the REAL service code
 * path (`registerPartials` + `compileTemplate`), so what is asserted is the
 * exact `html` nodemailer would put on the wire — not a component tree that a
 * mocked `compileTemplate` never turned into markup.
 *
 * The attack: any signed-up user can name an organization
 * `Acme</p><p><a href="https://evil.example/login">…</a></p><p>` and invite an
 * arbitrary address. The invitation body used to interpolate that name into an
 * unescaped text block, so the anchor was delivered verbatim in a mail sent
 * from the default sender address.
 */

// getTemplatePath() resolves against process.cwd(); pin it so the suite does
// not depend on the directory jest was started from.
const SERVICE_ROOT = join(__dirname, '..', '..', '..');
let cwdSpy: jest.SpyInstance;

beforeAll(() => {
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(SERVICE_ROOT);
});
afterAll(() => {
  cwdSpy.mockRestore();
});

function makeService() {
  const secrets: any = { getSecret: jest.fn(() => undefined) };
  const config: any = { get: jest.fn(() => 'https://app.example.com/') };
  const logger: any = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new MailService(
    secrets,
    config,
    {} as any,
    {} as any,
    logger,
  );
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
  // Bypass onModuleInit: it would build a real SMTP transport and verify it.
  (service as any).transporter = { sendMail };
  return { service, sendMail };
}

/** The mail as nodemailer would receive it, templates really rendered. */
async function sent(
  run: (service: MailService) => Promise<unknown>,
): Promise<{ html: string; subject: string }> {
  const { service, sendMail } = makeService();
  await (service as any).registerPartials();
  await run(service);
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0][0];
}

const ORG_PAYLOAD =
  'Acme</p><p><a href="https://evil.example/login">Your session expired, sign in again</a></p><p>';
const ROLE_PAYLOAD = '<img src="x" onerror="alert(1)">administrator';

function invite(organizationName: string, organizationRole = 'member') {
  return sent((service) =>
    service.sendOrganizationInviteEmail({
      id: 'i1',
      token: 'tok',
      email: 'victim@example.com',
      status: 'pending',
      organizationId: 'o1',
      organizationName,
      organizationRole,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    } as any),
  );
}

describe('transactional mail bodies escape attacker-controlled values', () => {
  it('invitation: an organization name carrying markup lands as text, not as HTML', async () => {
    const { html } = await invite(ORG_PAYLOAD);

    // The decisive assertion: no anchor pointing at the attacker's site.
    // Matched on `href="https://evil.example` rather than on the bare domain,
    // because the legitimate "Accept Invitation" button carries the name
    // percent-encoded in its query string (…organizationName=%3C%2Fp%3E…), so
    // the substring "evil.example" does — harmlessly — occur there too.
    expect(html).not.toMatch(/<a[^>]*href="https:\/\/evil\.example/i);
    expect(html).not.toContain('sign in again</a>');
    // …and the payload is still delivered whole, visibly inert.
    expect(html).toContain('Acme&lt;/p&gt;&lt;p&gt;&lt;a href');
  });

  it('invitation: the role is escaped too', async () => {
    const { html } = await invite('Acme', ROLE_PAYLOAD);

    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&lt;img');
  });

  it('invitation: the <h1> title stays escaped as well', async () => {
    const { html } = await invite(ORG_PAYLOAD);
    const title = html.slice(html.indexOf('<h1'), html.indexOf('</h1>'));

    expect(title).toContain('&lt;a href');
    expect(title).not.toMatch(/<a\b/i);
  });

  it('welcome: the user-supplied name is escaped', async () => {
    const { html } = await sent((service) =>
      service.sendWelcomeEmail(
        'user@example.com',
        '<script>alert(1)</script>Bob',
      ),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Bob');
  });

  it('the layout prints nothing unescaped: a `head` value in the data is not rendered', async () => {
    const { service } = makeService();
    await (service as any).registerPartials();

    const html = await service.render('mainTemplate', {
      head: '<script>alert(1)</script>',
      title: 'Title',
      components: [],
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });
});
