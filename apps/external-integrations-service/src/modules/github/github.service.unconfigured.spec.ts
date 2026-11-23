jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));

const mockOctokitInstance = { request: jest.fn() };
const MockOctokit = jest.fn().mockImplementation(() => mockOctokitInstance);
(MockOctokit as any).plugin = jest.fn().mockReturnValue(MockOctokit);

jest.mock('@octokit/rest', () => ({
  Octokit: MockOctokit,
}));
jest.mock('@octokit/plugin-retry', () => ({
  retry: jest.fn(),
}));
jest.mock('@octokit/plugin-throttling', () => ({
  throttling: jest.fn(),
}));

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
import { createAppAuth } from '@octokit/auth-app';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import SecretsService from '../../core/secrets/secrets.service';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { entitlementsMock } from '../../test-utils/entitlements.mock';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedCreateAppAuth = createAppAuth as jest.Mock;

/**
 * A Community instance without a GitHub App must boot. The service is
 * built directly from plain doubles, the way test-utils/gitlab-service.builder.ts
 * builds GitlabService.
 */
function buildGithubService(options: {
  secrets?: Record<string, string>;
  config?: Record<string, string>;
}) {
  const secrets: Record<string, string> = options.secrets ?? {};
  const config: Record<string, string> = {
    GATEWAY_URL: 'https://gw.example.com',
    ...(options.config ?? {}),
  };

  const service = new GithubService(
    createMockRepository() as never,
    createMockRepository() as never,
    createMockRepository() as never,
    {} as never, // dataSource
    { get: (key: string) => config[key] } as unknown as ConfigService,
    {
      getSecret: (key: string) => secrets[key],
    } as unknown as SecretsService,
    createLoggerMock() as never,
    entitlementsMock() as never,
    { getService: jest.fn() } as never, // SECURITY_SCANNING_SERVICE
    { getService: jest.fn() } as never, // FILE_MANAGEMENT_SERVICE
    { getService: jest.fn() } as never, // GLOBAL_MANAGEMENT_SERVICE
    {} as never, // repoScanQueue
    {} as never, // pendingRescans
    {} as never, // productLinks
    {} as never, // repoHistory
  );
  return service;
}

describe('GithubService — unconfigured GitHub App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('boots without a GitHub App', () => {
    const service = buildGithubService({});

    expect(service.isGithubAppConfigured()).toBe(false);
  });

  it('refuses GitHub calls with GITHUB_APP_NOT_CONFIGURED', async () => {
    const service = buildGithubService({});

    await expect(
      service.getRepositories({ organizationId: 'org-1' } as any),
    ).rejects.toMatchObject({
      error: {
        code: status.FAILED_PRECONDITION,
        message: 'GITHUB_APP_NOT_CONFIGURED',
      },
    });
    // No HTTP call of any kind left the process.
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockOctokitInstance.request).not.toHaveBeenCalled();
  });

  it('keeps the escaped newlines of a configured key', async () => {
    const service = buildGithubService({
      secrets: { GITHUB_APP_ID: '123', GITHUB_PRIVATE_KEY: 'a\\nb' },
    });
    expect(service.isGithubAppConfigured()).toBe(true);

    mockedCreateAppAuth.mockReturnValue(
      jest.fn().mockResolvedValue({ token: 'tok' }),
    );
    const repoRepository = (service as any).githubRepositoryIntegration;
    repoRepository.findOne.mockResolvedValue({
      fullName: 'octo/demo',
      defaultBranch: 'main',
      integration: { installationId: 42, organizationId: 'org-1' },
    });

    const result = await service.getAccessTokenForProject('project-1');

    expect(result.accessToken).toBe('tok');
    expect(mockedCreateAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 123,
        privateKey: 'a\nb',
        installationId: 42,
      }),
    );
  });
});
