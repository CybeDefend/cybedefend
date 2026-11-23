import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MailService } from './mail.service';

/**
 * No mail loads anything from a remote host: an image fetched when the mail
 * is opened tells that host who opened it, when, and from where, and a
 * self-hosted instance must not send its users' mail clients to anyone. The
 * logo ships beside the templates and travels inside the mail as an inline
 * (CID) attachment, which every common mail client renders without a fetch.
 */

const SERVICE_ROOT = join(__dirname, '..', '..', '..');
const TEMPLATES = join(__dirname, 'templates');
let cwdSpy: jest.SpyInstance;
beforeAll(() => {
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(SERVICE_ROOT);
});
afterAll(() => cwdSpy.mockRestore());

function templateFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return templateFiles(path);
    return name.endsWith('.hbs') ? [path] : [];
  });
}

function makeService(
  sendMail = jest.fn().mockResolvedValue({ messageId: 'x' }),
) {
  const secrets: any = { getSecret: jest.fn(() => undefined) };
  const config: any = {
    get: jest.fn((k: string) =>
      k === 'EMAIL_FROM' ? 'noreply@example.com' : 'https://app.example.com/',
    ),
  };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new MailService(
    secrets,
    config,
    {} as any,
    {} as any,
    logger as any,
  );
  (service as any).transporter = { sendMail };
  return { service, sendMail };
}

const REMOTE_URL = /https?:\/\//i;
// What a mail client fetches on its own when it opens the mail: an image
// source, a background, a CSS url(). Links the reader clicks are not fetched.
const REMOTE_FETCH =
  /(?:\bsrc|\bbackground)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i;

function expectInlineLogo(mail: any) {
  expect(mail.html).toContain('cid:header-logo');
  expect(mail.html).not.toMatch(REMOTE_FETCH);
  const logo = (mail.attachments ?? []).filter(
    (a: any) => a.cid === 'header-logo',
  );
  expect(logo).toHaveLength(1);
  expect(logo[0].path).toMatch(/templates\/assets\/header-logo\.png$/);
  expect(existsSync(logo[0].path)).toBe(true);
}

describe('mail templates: no remote asset', () => {
  const files = templateFiles(TEMPLATES);

  it('finds the templates', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [relative(TEMPLATES, f), f]))(
    '%s names no remote URL',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).not.toMatch(REMOTE_URL);
    },
  );

  it('ships the header logo beside the templates', () => {
    expect(existsSync(join(TEMPLATES, 'assets', 'header-logo.png'))).toBe(true);
  });
});

describe('MailService: the logo travels inline', () => {
  it('attaches the logo to a mail built on the main template', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();

    await service.sendWelcomeEmail('new@example.com', 'Ann');

    expectInlineLogo(sendMail.mock.calls[0][0]);
  });

  it('attaches the logo to a report mail', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();
    jest.spyOn(service as any, 'fetchProjectAccessPairs').mockResolvedValue([
      {
        userId: 'u1',
        email: 'ann@example.com',
        firstName: 'Ann',
        notification: true,
        projectId: 'p1',
      },
    ]);

    await service.sendConsolidatedWeeklyReportEmail({
      organizationId: 'o1',
      projects: [
        {
          projectId: 'p1',
          projectName: 'web',
          severities: { critical: 1, high: 0, medium: 0, low: 0 },
          total: 1,
          topRecent: [],
        },
      ],
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expectInlineLogo(sendMail.mock.calls[0][0]);
  });

  it('attaches the logo to a mail sent through deliver()', async () => {
    const { service, sendMail } = makeService();
    await (service as any).registerPartials();
    const html = await service.render('mainTemplate', {
      title: 't',
      components: [],
    });

    await service.deliver({ to: 'a@example.com', subject: 's', html });

    expectInlineLogo(sendMail.mock.calls[0][0]);
  });

  it('keeps the attachments a caller gave, and adds no logo a mail does not show', async () => {
    const { service, sendMail } = makeService();
    const own = { filename: 'a.txt', content: 'x' };

    await service.deliver({
      to: 'a@example.com',
      subject: 's',
      html: '<p>plain</p>',
      attachments: [own],
    });

    expect(sendMail.mock.calls[0][0].attachments).toEqual([own]);
  });
});
