// adm-zip exports a CJS constructor function; ts-jest wraps it in a way that
// makes it non-callable, so mark it __esModule to keep `new AdmZip()` working.
jest.mock('adm-zip', () => {
  const actual = jest.requireActual<any>('adm-zip');
  actual.__esModule = true;
  actual.default = actual;
  return actual;
});

jest.mock('axios');

import { status } from '@grpc/grpc-js';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { GitlabService } from './gitlab.service';
import SecretsService from '../../core/secrets/secrets.service';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { entitlementsMock } from '../../test-utils/entitlements.mock';

const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * A Community instance without GitLab and without any public app URL
 * must boot. The service is built directly from plain doubles, the way
 * test-utils/gitlab-service.builder.ts builds it.
 */
function buildGitlabService(options: {
  secrets?: Record<string, string>;
  config?: Record<string, string>;
  redisGet?: jest.Mock;
}) {
  const secrets: Record<string, string> = options.secrets ?? {};
  const config: Record<string, string> = { ...(options.config ?? {}) };
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    get: options.redisGet ?? jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  };

  const service = new GitlabService(
    createMockRepository() as never, // gitlabIntegrationRepository
    createMockRepository() as never, // gitlabRepositoryRepository
    createMockRepository() as never, // gitlabBranchRepository
    {} as never, // dataSource
    {
      getSecret: jest.fn(async (key: string) => secrets[key]),
    } as unknown as SecretsService,
    redis as never, // REDIS_CLIENT
    createLoggerMock() as never,
    { get: (key: string) => config[key] } as unknown as ConfigService,
    { getService: jest.fn() } as never, // SECURITY_SCANNING_SERVICE
    { getService: jest.fn() } as never, // FILE_MANAGEMENT_SERVICE
    { getService: jest.fn() } as never, // GLOBAL_MANAGEMENT_SERVICE
    {} as never, // repoScanQueue
    entitlementsMock() as never, // entitlements
    {} as never, // pendingRescans
    {} as never, // repoHistory
  );
  return { service, redis };
}

describe('GitlabService — unconfigured GitLab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('boots without GitLab or FRONTEND_URL', async () => {
    const { service } = buildGitlabService({});

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isGitlabConfigured()).toBe(false);
  });

  it('refuses the OAuth exchange with GITLAB_NOT_CONFIGURED', async () => {
    const redisGet = jest.fn().mockResolvedValue('state-1');
    const { service } = buildGitlabService({ redisGet });
    await service.onModuleInit();

    await expect(
      service.callbackInstall({
        organizationId: 'org-1',
        userId: 'user-1',
        code: 'code-1',
        state: 'state-1',
      } as any),
    ).rejects.toMatchObject({
      error: {
        code: status.FAILED_PRECONDITION,
        message: 'GITLAB_NOT_CONFIGURED',
      },
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('builds the redirect from APP_PUBLIC_URL', async () => {
    const { service } = buildGitlabService({
      config: { APP_PUBLIC_URL: 'https://appsec.acme.test' },
      secrets: {
        GITLAB_APPLICATION_ID: 'app',
        GITLAB_APPLICATION_SECRET: 'secret',
        GITLAB_ENCRYPTION_KEY:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    });
    await service.onModuleInit();
    expect(service.isGitlabConfigured()).toBe(true);

    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 'api',
        token_type: 'bearer',
      },
    });

    await (service as any).exchangeCodeForToken('code-1');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        redirect_uri: 'https://appsec.acme.test/integrations/gitlab/callback',
      }),
      expect.anything(),
    );
  });
});
