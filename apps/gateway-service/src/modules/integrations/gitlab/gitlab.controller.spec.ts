import 'reflect-metadata';
import { HttpException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { GitlabController } from './gitlab.controller';
import { CombinedAuthRateLimitGuard } from '../../../core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

describe('GitlabController.disconnect', () => {
  const handler = GitlabController.prototype.disconnect;

  it('is DELETE /integrations/gitlab/organization/:organizationId/disconnect', () => {
    expect(Reflect.getMetadata(PATH_METADATA, GitlabController)).toBe(
      'integrations/gitlab',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'organization/:organizationId/disconnect',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.DELETE,
    );
  });

  it('is authenticated and rate limited by the class guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GitlabController)).toEqual([
      CombinedAuthRateLimitGuard,
    ]);
  });

  it('checks manage_integration on the organization of the path', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata('permissions', handler)).toEqual([
      'manage_integration',
    ]);
    expect(Reflect.getMetadata('subjectTypes', handler)).toEqual([
      'organization',
    ]);
  });

  it('relays the organization of the path to external-integrations', async () => {
    const gitlabService = {
      disconnect: jest.fn().mockResolvedValue({
        success: true,
        message: 'GitLab integration disconnected',
      }),
    };
    const controller = new GitlabController(
      gitlabService as never,
      {} as never,
      {} as never,
      { log: jest.fn() } as never,
      {} as never,
      // The product check of startScan: unused by disconnect.
      {} as never,
    );

    await expect(
      controller.disconnect({ user: { sub: 'user-1' } } as never, 'org-1'),
    ).resolves.toEqual({
      success: true,
      message: 'GitLab integration disconnected',
    });
    expect(gitlabService.disconnect).toHaveBeenCalledWith('org-1');
  });
});

describe('GitlabController.generateInstallUrl', () => {
  const makeController = (
    config: Record<string, string | undefined>,
    // null: the secret is not set at all.
    clientId: string | null = 'gitlab-client-id',
  ) => {
    const secretsService = {
      getSecret: jest.fn().mockResolvedValue(clientId ?? undefined),
    };
    const configService = {
      get: jest.fn((key: string) => config[key]),
    };
    const redisClient = { set: jest.fn().mockResolvedValue('OK') };
    const controller = new GitlabController(
      {} as never,
      secretsService as never,
      configService as never,
      { log: jest.fn() } as never,
      redisClient as never,
      {} as never,
    );
    return { controller, configService, redisClient };
  };

  it.each([null, ''])(
    'answers 400 GITLAB_NOT_CONFIGURED, and stores no state, when the application id is %p',
    async (clientId) => {
      const { controller, redisClient } = makeController(
        { FRONTEND_URL: 'https://app.example.org' },
        clientId,
      );

      const refusal = await controller
        .generateInstallUrl('org-1')
        .then(() => undefined)
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(HttpException);
      expect((refusal as HttpException).getStatus()).toBe(400);
      expect((refusal as HttpException).message).toBe('GITLAB_NOT_CONFIGURED');
      expect(redisClient.set).not.toHaveBeenCalled();
    },
  );

  it('builds the authorize URL on gitlab.com when GITLAB_API_URL is unset', async () => {
    const { controller } = makeController({
      FRONTEND_URL: 'https://app.example.org',
    });

    const { installUrl } = await controller.generateInstallUrl('org-1');

    expect(installUrl).toMatch(
      /^https:\/\/gitlab\.com\/oauth\/authorize\?client_id=gitlab-client-id&/,
    );
  });

  it('builds the authorize URL on the configured instance', async () => {
    const { controller } = makeController({
      FRONTEND_URL: 'https://app.example.org',
      GITLAB_API_URL: 'https://git.example.org/api/v4',
    });

    const { installUrl } = await controller.generateInstallUrl('org-1');

    expect(installUrl).toMatch(
      /^https:\/\/git\.example\.org\/oauth\/authorize\?client_id=/,
    );
  });
});
