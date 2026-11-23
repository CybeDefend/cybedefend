import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { MailService } from './mail.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

// The welcome mail is the bridge from the device a user signed up on to the
// computer where they will actually connect a repository. Its one button must
// point at the configured FRONTEND_URL, never a hardcoded localhost URL.

const sendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail, close: jest.fn() })),
}));
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as any),
  existsSync: jest.fn().mockReturnValue(true),
}));
// A template that prints every component's link, so the assertion reads the
// HTML that is actually sent rather than an internal argument.
jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue(['header.hbs']),
  readFile: jest
    .fn()
    .mockResolvedValue(
      '{{#each components}}[{{this.text}}]({{this.url}}) {{/each}}',
    ),
}));

/** Every MailService built by the current test. */
const built: MailService[] = [];

const buildService = async (frontendUrl: string): Promise<MailService> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MailService,
      {
        provide: SecretsService,
        useValue: { getSecret: jest.fn().mockReturnValue('x') },
      },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) =>
            key === 'FRONTEND_URL' ? frontendUrl : 'x',
          ),
        },
      },
      {
        provide: Logger,
        useValue: {
          log: jest.fn(),
          error: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        },
      },
      { provide: getRepositoryToken(Organization), useValue: {} },
      { provide: getRepositoryToken(Project), useValue: {} },
    ],
  }).compile();

  const service = module.get<MailService>(MailService);
  await service.onModuleInit();
  built.push(service);
  return service;
};

describe('MailService — welcome mail link', () => {
  beforeEach(() => sendMail.mockClear());
  // Give the shared SMTP transport back, as the application's shutdown does.
  afterEach(() => {
    for (const service of built.splice(0)) service.beforeApplicationShutdown();
  });

  it("points the button at this environment's dashboard, not at localhost", async () => {
    const service = await buildService('https://eu.cybedefend.test');

    await service.sendWelcomeEmail('ada@example.test', 'Ada');

    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('[Get Started](https://eu.cybedefend.test)');
    expect(html).not.toContain('localhost');
  });

  it('tolerates a trailing slash in FRONTEND_URL, like every other mail', async () => {
    const service = await buildService('https://us.cybedefend.test/');

    await service.sendWelcomeEmail('ada@example.test', 'Ada');

    const { html } = sendMail.mock.calls[0][0];
    expect(html).toContain('[Get Started](https://us.cybedefend.test)');
  });
});
