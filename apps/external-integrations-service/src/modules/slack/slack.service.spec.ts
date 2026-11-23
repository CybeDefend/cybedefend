import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { RpcException } from '@nestjs/microservices';

import { SlackService } from './slack.service';
import { SlackMessageService } from './slack-message.service';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import { SlackChannelMapping } from '../../entities/slack-channel-mapping.entity';
import SecretsService from '../../core/secrets/secrets.service';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { ENTITLEMENTS_PORT } from '../../edition/ports/entitlements.port';
import { entitlementsMock } from '../../test-utils/entitlements.mock';

describe('SlackService.sendNotification (writes_blocked gate)', () => {
  let service: SlackService;
  let channelMappingRepo: ReturnType<typeof createMockRepository>;
  let slackIntegrationRepo: ReturnType<typeof createMockRepository>;
  let billingWritable: { isWritable: jest.Mock; assertWritable: jest.Mock };

  beforeEach(async () => {
    channelMappingRepo = createMockRepository();
    slackIntegrationRepo = createMockRepository();

    billingWritable = {
      isWritable: jest.fn().mockResolvedValue(true),
      assertWritable: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackService,
        {
          provide: getRepositoryToken(SlackIntegration),
          useValue: slackIntegrationRepo,
        },
        {
          provide: getRepositoryToken(SlackChannelMapping),
          useValue: channelMappingRepo,
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
        {
          provide: ENTITLEMENTS_PORT,
          useValue: entitlementsMock({
            assertWritable: billingWritable.assertWritable,
          }),
        },
      ],
    }).compile();

    service = module.get(SlackService);
    service.onModuleInit();
  });

  it('rejects with WRITES_BLOCKED when channel-mapped org is in read-only mode', async () => {
    // The mapping is found and exposes its parent integration's organizationId.
    channelMappingRepo.findOne.mockResolvedValue({
      channelId: 'C1',
      channelName: 'general',
      integration: { organizationId: 'org-1', accessToken: 'enc' },
    } as any);

    billingWritable.assertWritable.mockRejectedValue(
      new RpcException({ code: 7, message: 'WRITES_BLOCKED' }),
    );

    await expect(
      service.sendNotification({
        projectId: 'p1',
        notificationType: 'scan_complete',
        payloadJson: '{}',
      } as any),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('returns success=false (no-op) when no channel mapping exists — gate not hit', async () => {
    channelMappingRepo.findOne.mockResolvedValue(null);

    const res = await service.sendNotification({
      projectId: 'p1',
      notificationType: 'scan_complete',
      payloadJson: '{}',
    } as any);

    expect(res.success).toBe(false);
    // No mapping → no org to check, gate is not invoked
    expect(billingWritable.assertWritable).not.toHaveBeenCalled();
  });

  describe('disconnect', () => {
    it('removes the integration and its channel mappings', async () => {
      const integration = { id: 'int-1', organizationId: 'org-1' };
      slackIntegrationRepo.findOne.mockResolvedValue(integration);

      const res = await service.disconnect({ organizationId: 'org-1' } as any);

      expect(res.success).toBe(true);
      expect(channelMappingRepo.delete).toHaveBeenCalledWith({
        integrationId: 'int-1',
      });
      expect(slackIntegrationRepo.remove).toHaveBeenCalledWith(integration);
    });

    // Same reasoning as JiraService.disconnect: disconnecting is the
    // organization's only way out, so an already-disconnected org (double
    // click, retry, or a row already swept by the org-deletion teardown) must
    // not surface as an error.
    it('succeeds when there is nothing left to disconnect', async () => {
      slackIntegrationRepo.findOne.mockResolvedValue(null);

      const res = await service.disconnect({ organizationId: 'org-1' } as any);

      expect(res.success).toBe(true);
      expect(slackIntegrationRepo.remove).not.toHaveBeenCalled();
    });
  });
});
