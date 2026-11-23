import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { MailService } from './mail.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

/**
 * SMTP is optional (the Community Edition runs without it). With no
 * EMAIL_HOST the service boots no transport, every send method returns early
 * with one WARN naming it, and the invitation mail answers `false` so the
 * caller keeps the token and can show the invitee the link itself.
 */

const sendMail = jest.fn().mockResolvedValue({});
const createTransport = jest.fn((...args: any[]) => ({
  __args: args,
  sendMail,
  verify: jest.fn().mockResolvedValue(true),
  close: jest.fn(),
}));
jest.mock('nodemailer', () => ({
  createTransport: (...args: any[]) => createTransport(...args),
}));
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as any),
  existsSync: jest.fn().mockReturnValue(true),
}));
jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue(['header.hbs']),
  readFile: jest.fn().mockResolvedValue('<div>{{title}}</div>'),
}));

/** Every MailService built by the current test. */
const built: MailService[] = [];

interface TestEnv {
  emailHost?: string;
  emailFrom?: string;
  emailSecure?: string;
}

const buildService = async (
  env: TestEnv,
): Promise<{
  service: MailService;
  logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
}> => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MailService,
      {
        provide: SecretsService,
        useValue: {
          getSecret: jest.fn((key: string) =>
            key === 'EMAIL_HOST' ? env.emailHost : 'x',
          ),
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) => {
            if (key === 'FRONTEND_URL') return 'https://app.example.test';
            if (key === 'EMAIL_FROM') return env.emailFrom;
            if (key === 'EMAIL_SECURE') return env.emailSecure ?? 'true';
            return 'x';
          }),
        },
      },
      { provide: Logger, useValue: logger },
      { provide: getRepositoryToken(Organization), useValue: {} },
      { provide: getRepositoryToken(Project), useValue: {} },
    ],
  }).compile();

  const service = module.get<MailService>(MailService);
  await service.onModuleInit();
  built.push(service);
  return { service, logger };
};

const invite = {
  id: 'i1',
  token: 'tok',
  email: 'invitee@example.test',
  status: 'pending',
  organizationId: 'o1',
  organizationName: 'Acme',
  organizationRole: 'member',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
} as any;

describe('MailService without SMTP', () => {
  beforeEach(() => {
    createTransport.mockClear();
    sendMail.mockClear();
  });
  // Give the shared SMTP transport back, as the application's shutdown does.
  afterEach(() => {
    for (const service of built.splice(0)) service.beforeApplicationShutdown();
  });

  it('creates no transport without EMAIL_HOST', async () => {
    const { service } = await buildService({ emailHost: undefined });

    expect(service.isConfigured()).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('skips the invitation mail and says so', async () => {
    const { service, logger } = await buildService({ emailHost: '' });

    await expect(service.sendOrganizationInviteEmail(invite)).resolves.toBe(
      false,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'MAIL_SKIPPED_NO_SMTP kind=sendOrganizationInviteEmail',
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('skips the welcome mail without throwing', async () => {
    const { service, logger } = await buildService({ emailHost: undefined });

    await expect(
      service.sendWelcomeEmail('ada@example.test', 'Ada'),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'MAIL_SKIPPED_NO_SMTP kind=sendWelcomeEmail',
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('skips every other mail with one WARN naming the method', async () => {
    const { service, logger } = await buildService({ emailHost: undefined });

    await expect(
      service.sendOrganizationDeletionCodeEmail({
        to: 'creator@example.test',
        organizationName: 'Acme',
        code: '123456',
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'MAIL_SKIPPED_NO_SMTP kind=sendOrganizationDeletionCodeEmail',
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends from EMAIL_FROM', async () => {
    const { service } = await buildService({
      emailHost: 'smtp.test',
      emailFrom: '"Acme" <sec@acme.test>',
    });

    await expect(service.sendOrganizationInviteEmail(invite)).resolves.toBe(
      true,
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].from).toBe('"Acme" <sec@acme.test>');
  });

  it('uses EMAIL_SECURE=false for STARTTLS', async () => {
    await buildService({ emailHost: 'smtp.test', emailSecure: 'false' });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0][0].secure).toBe(false);
  });

  it('keeps TLS on by default', async () => {
    await buildService({ emailHost: 'smtp.test' });

    expect(createTransport.mock.calls[0][0].secure).toBe(true);
  });
});
