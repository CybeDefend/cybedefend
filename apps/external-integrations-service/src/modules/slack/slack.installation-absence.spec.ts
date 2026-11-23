import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { SlackService } from './slack.service';
import { SlackMessageService } from './slack-message.service';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import { SlackChannelMapping } from '../../entities/slack-channel-mapping.entity';
import SecretsService from '../../core/secrets/secrets.service';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';

/**
 * "This organization has no Slack integration" is a NORMAL outcome, not a
 * failure: the gateway's integrations overview probes all four providers on
 * every page load, so an org without Slack produces it on a happy path.
 *
 * Throwing RpcException(NOT_FOUND) would make every span of the call chain an
 * error span, across two services, on every page load. Two independent
 * mechanisms mark them: the nestjs-otel @Span decorator (which sets
 * SpanStatusCode.ERROR on ANY rejection) and the gRPC auto-instrumentation
 * (which marks any non-zero gRPC code as an error on both client and server).
 * Only removing the non-OK status from the wire silences both.
 *
 * Absence is therefore conveyed by an empty response, exactly as
 * gitlab.service.ts already does. The REST 404 is preserved by the gateway
 * controller — see the gateway-side spec.
 */
describe('SlackService.getInstallationForOrga — absence is not an error', () => {
  let service: SlackService;
  let slackIntegrationRepo: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    slackIntegrationRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackService,
        {
          provide: getRepositoryToken(SlackIntegration),
          useValue: slackIntegrationRepo,
        },
        {
          provide: getRepositoryToken(SlackChannelMapping),
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
        {
          provide: SlackMessageService,
          useValue: {
            buildMessage: jest.fn().mockReturnValue({}),
            getFallbackText: jest.fn().mockReturnValue(''),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: ENTITLEMENTS_PORT, useValue: entitlementsMock() },
      ],
    }).compile();

    service = module.get(SlackService);
    service.onModuleInit();
  });

  it('resolves instead of throwing when the org has no integration', async () => {
    slackIntegrationRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getInstallationForOrga({ organizationId: 'org-without-slack' }),
    ).resolves.toBeDefined();
  });

  it('signals absence with isConfigured=false', async () => {
    slackIntegrationRepo.findOne.mockResolvedValue(null);

    const response = await service.getInstallationForOrga({
      organizationId: 'org-without-slack',
    });

    // Explicit flag, mirroring is_configured on GetProjectChannelResponse /
    // GetProjectJiraConfigResponse in the same proto files — the house way of
    // answering "absent" without an error.
    expect(response.isConfigured).toBe(false);
    expect(response.id).toBe('');
  });

  it('still returns the real installation when one exists', async () => {
    slackIntegrationRepo.findOne.mockResolvedValue({
      id: 'inst-1',
      teamId: 'T123',
      teamName: 'Acme',
      organizationId: 'org-1',
      installedByUserId: 'u-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    } as any);

    const response = await service.getInstallationForOrga({
      organizationId: 'org-1',
    });

    expect(response.isConfigured).toBe(true);
    expect(response.id).toBe('inst-1');
    expect(response.teamName).toBe('Acme');
  });
});
