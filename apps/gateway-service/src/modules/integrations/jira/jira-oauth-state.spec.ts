import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { JiraController } from './jira.controller';
import { JiraService } from './jira.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('JiraController OAuth State (CSRF Protection)', () => {
  let controller: JiraController;
  let redisClient: {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
  };
  let jiraService: {
    callbackInstall: jest.Mock;
    generateOAuthUrl: jest.Mock;
  };

  beforeEach(async () => {
    redisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
    };

    jiraService = {
      callbackInstall: jest.fn().mockResolvedValue({
        returnUri: 'https://app.example.com',
      }),
      generateOAuthUrl: jest.fn().mockImplementation(async (dto) => ({
        installUrl: `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=test-client-id&scope=read%3Ajira-work%20write%3Ajira-work%20read%3Ajira-user%20manage%3Ajira-webhook%20offline_access&redirect_uri=${encodeURIComponent(dto.redirectUri)}&state=${dto.state}&response_type=code&prompt=consent`,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [JiraController],
      providers: [
        { provide: JiraService, useValue: jiraService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map = {
                FRONTEND_URL: 'https://app.example.com',
              };
              return map[key];
            },
          },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: 'REDIS_CLIENT', useValue: redisClient },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<JiraController>(JiraController);
  });

  // ==================== generateInstallUrl ====================

  describe('generateInstallUrl', () => {
    const orgId = '550e8400-e29b-41d4-a716-446655440000';

    it('should store a state token in Redis with 600s TTL', async () => {
      await controller.generateInstallUrl(orgId);

      expect(redisClient.set).toHaveBeenCalledTimes(1);
      const [key, , ex, ttl] = redisClient.set.mock.calls[0];
      expect(key).toBe(`jira_oauth_state:${orgId}`);
      expect(ex).toBe('EX');
      expect(ttl).toBe(600);
    });

    it('should return a URL containing the state and auth.atlassian.com', async () => {
      const result = await controller.generateInstallUrl(orgId);

      expect(result).toHaveProperty('installUrl');
      expect(result.installUrl).toContain(
        'https://auth.atlassian.com/authorize',
      );
      expect(result.installUrl).toContain('client_id=test-client-id');

      // The state stored in Redis must appear in the URL
      const storedState = redisClient.set.mock.calls[0][1];
      expect(result.installUrl).toContain(`state=${storedState}`);
    });

    it('should return a URL with correct redirect_uri based on FRONTEND_URL', async () => {
      const result = await controller.generateInstallUrl(orgId);

      const expectedRedirect = encodeURIComponent(
        'https://app.example.com/integrations/jira/callback',
      );
      expect(result.installUrl).toContain(`redirect_uri=${expectedRedirect}`);
    });

    it('should include required Jira scopes in the URL', async () => {
      const result = await controller.generateInstallUrl(orgId);

      expect(result.installUrl).toContain('read%3Ajira-work');
      expect(result.installUrl).toContain('write%3Ajira-work');
      expect(result.installUrl).toContain('manage%3Ajira-webhook');
    });
  });

  // ==================== callbackInstall ====================

  describe('callbackInstall - state validation', () => {
    const orgId = '550e8400-e29b-41d4-a716-446655440000';
    const mockReq = { user: { sub: 'user-123' } };
    const validDto = {
      code: 'auth-code-123',
      redirectUri: 'https://app.example.com/integrations/jira/callback',
      state: 'valid-state-token',
    };

    it('should reject when state does not match Redis', async () => {
      redisClient.get.mockResolvedValue('different-state-token');

      await expect(
        controller.callbackInstall(mockReq, validDto as any, orgId),
      ).rejects.toThrow(BadRequestException);

      expect(redisClient.del).not.toHaveBeenCalled();
      expect(jiraService.callbackInstall).not.toHaveBeenCalled();
    });

    it('should reject when no state exists in Redis (expired)', async () => {
      redisClient.get.mockResolvedValue(null);

      await expect(
        controller.callbackInstall(mockReq, validDto as any, orgId),
      ).rejects.toThrow(BadRequestException);

      expect(redisClient.del).not.toHaveBeenCalled();
      expect(jiraService.callbackInstall).not.toHaveBeenCalled();
    });

    it('should accept matching state, delete from Redis, and call jiraService', async () => {
      redisClient.get.mockResolvedValue('valid-state-token');

      await controller.callbackInstall(mockReq, validDto as any, orgId);

      // State should be deleted after successful validation
      expect(redisClient.del).toHaveBeenCalledWith(`jira_oauth_state:${orgId}`);

      // Should proceed with the callback
      expect(jiraService.callbackInstall).toHaveBeenCalledWith({
        organizationId: orgId,
        userId: 'user-123',
        code: 'auth-code-123',
        redirectUri: 'https://app.example.com/integrations/jira/callback',
      });
    });
  });
});
