import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { JiraService } from './jira.service';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import SecretsService from '../../core/secrets/secrets.service';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';

/** See slack.installation-absence.spec.ts for the full rationale. */
describe('JiraService.getInstallationForOrga — absence is not an error', () => {
  let service: JiraService;
  let jiraIntegrationRepo: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    jiraIntegrationRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraService,
        {
          provide: getRepositoryToken(JiraIntegration),
          useValue: jiraIntegrationRepo,
        },
        {
          provide: getRepositoryToken(JiraProjectMapping),
          useValue: createMockRepository(),
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        {
          provide: SecretsService,
          useValue: { getSecret: jest.fn().mockReturnValue('') },
        },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();

    service = module.get(JiraService);
  });

  it('resolves instead of throwing when the org has no integration', async () => {
    jiraIntegrationRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getInstallationForOrga({ organizationId: 'org-without-jira' }),
    ).resolves.toBeDefined();
  });

  it('signals absence with isConfigured=false', async () => {
    jiraIntegrationRepo.findOne.mockResolvedValue(null);

    const response = await service.getInstallationForOrga({
      organizationId: 'org-without-jira',
    });

    expect(response.isConfigured).toBe(false);
    expect(response.id).toBe('');
  });

  it('still returns the real installation when one exists', async () => {
    jiraIntegrationRepo.findOne.mockResolvedValue({
      id: 'inst-9',
      cloudId: 'cloud-9',
      siteName: 'acme.atlassian.net',
      siteUrl: 'https://acme.atlassian.net',
      organizationId: 'org-9',
      installedByUserId: 'u-9',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    } as any);

    const response = await service.getInstallationForOrga({
      organizationId: 'org-9',
    });

    expect(response.isConfigured).toBe(true);
    expect(response.id).toBe('inst-9');
    expect(response.siteName).toBe('acme.atlassian.net');
  });
});
