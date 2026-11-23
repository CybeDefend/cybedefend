import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { MailService } from './mail.service';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({}),
    close: jest.fn(),
  })),
}));
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as any),
  existsSync: jest.fn().mockReturnValue(true),
}));
jest.mock('fs/promises', () => ({
  readdir: jest.fn().mockResolvedValue(['header.hbs']),
  readFile: jest.fn().mockResolvedValue('<div>{{title}}</div>'),
}));

describe('MailService', () => {
  let service: MailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: SecretsService,
          useValue: { getSecret: jest.fn().mockReturnValue('x') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3002') },
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
        {
          provide: getRepositoryToken(Organization),
          useValue: {
            createQueryBuilder: jest.fn(() => ({
              innerJoin: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              getRawOne: jest
                .fn()
                .mockResolvedValue({ email: 'org@example.com' }),
            })),
          },
        },
        {
          provide: getRepositoryToken(Project),
          useValue: {
            createQueryBuilder: jest.fn(() => ({
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            })),
          },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    await service.onModuleInit();
  });

  // Give the shared SMTP transport back, as the application's shutdown does.
  afterEach(() => service.beforeApplicationShutdown());

  it('sendWelcomeEmail renders and sends', async () => {
    await expect(
      service.sendWelcomeEmail('user@example.com', 'User'),
    ).resolves.toBeUndefined();
  });

  it('sendOrganizationInviteEmail renders and sends', async () => {
    // SMTP is configured in this fixture, so the mail goes out and the
    // method answers true.
    await expect(
      service.sendOrganizationInviteEmail({
        id: 'i1',
        token: 'tok',
        email: 'u@example.com',
        status: 'pending',
        organizationId: 'o1',
        organizationName: 'Org',
        organizationRole: 'member',
        expiresAt: new Date().toISOString(),
      } as any),
    ).resolves.toBe(true);
  });
});
