import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { MailService } from './mail.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

// The invitation page compares the address the invitation was sent to with
// the account the invitee is signed in with, and warns before they accept
// with the wrong one. It learns that address from the link in this mail.

const sendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail, close: jest.fn() })),
}));
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as any),
  existsSync: jest.fn().mockReturnValue(true),
}));
// A template that prints every component's link unescaped, so the assertion
// reads the URL the button actually carries.
jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue(['header.hbs']),
  readFile: jest
    .fn()
    .mockResolvedValue('{{#each components}}<{{{this.url}}}> {{/each}}'),
}));

/** Every MailService built by the current test. */
const built: MailService[] = [];

const buildService = async (): Promise<MailService> => {
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
            key === 'FRONTEND_URL' ? 'https://eu.cybedefend.test' : 'x',
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

const inviteHref = (): string => {
  const { html } = sendMail.mock.calls[0][0];
  const [, href] = /<(https:\/\/[^>]+\/invite[^>]*)>/.exec(html) ?? [];
  if (!href) throw new Error(`no invitation link in: ${html}`);
  return href;
};

// The cloud cases (the token in the path) live in the closed edition.
describe('MailService — invitation link', () => {
  beforeEach(() => sendMail.mockClear());
  // Give the shared SMTP transport back, as the application's shutdown does.
  afterEach(() => {
    for (const service of built.splice(0)) service.beforeApplicationShutdown();
  });

  describe('in the Community Edition', () => {
    const previous = process.env.CYBEDEFEND_EDITION;
    beforeEach(() => {
      process.env.CYBEDEFEND_EDITION = 'community';
    });
    afterEach(() => {
      if (previous === undefined) delete process.env.CYBEDEFEND_EDITION;
      else process.env.CYBEDEFEND_EDITION = previous;
    });

    // The token travels in the fragment, which no server logs and no Referer
    // header carries: never in the path or the query.
    it('puts the token and the e-mail in the fragment, nothing in the path or the query', async () => {
      const service = await buildService();

      await service.sendOrganizationInviteEmail({
        id: 'inv-1',
        token: 'tok_-123',
        email: 'ada+security@example.test',
        status: 'pending',
        organizationId: 'o1',
        organizationName: 'Acme',
        organizationRole: 'member',
        expiresAt: '2026-09-23T10:00:00.000Z',
      });

      const href = inviteHref();
      expect(href).toBe(
        'https://eu.cybedefend.test/invite#token=tok_-123&email=ada%2Bsecurity%40example.test',
      );
      const link = new URL(href);
      expect(link.pathname).toBe('/invite');
      expect(link.search).toBe('');
      const fragment = new URLSearchParams(link.hash.slice(1));
      expect(fragment.get('token')).toBe('tok_-123');
      expect(fragment.get('email')).toBe('ada+security@example.test');
      expect([...fragment.keys()]).toEqual(['token', 'email']);
    });
  });
});
