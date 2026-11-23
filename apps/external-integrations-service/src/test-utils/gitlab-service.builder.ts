import { GitlabService } from '../modules/gitlab/gitlab.service';
import { entitlementsMock } from './entitlements.mock';
import { createMockRepository } from './mocks';

const SECRETS: Record<string, string> = {
  GITLAB_APPLICATION_ID: 'app',
  GITLAB_APPLICATION_SECRET: 'secret',
  // 64 hex characters: aes-256-gcm needs a 32-byte key.
  GITLAB_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

/**
 * A GitlabService built from plain mocks, for the specs that exercise its
 * connection state and its disconnection. gitlab.service.spec.ts
 * keeps its own Nest testing module.
 */
export async function buildGitlabService() {
  const integrationRepository = createMockRepository();
  const repositoryRepository = createMockRepository();
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const grpcClient = { getService: jest.fn(() => ({})) };
  const service = new GitlabService(
    integrationRepository as never,
    repositoryRepository as never,
    createMockRepository() as never,
    {} as never,
    { getSecret: jest.fn(async (key: string) => SECRETS[key]) } as never,
    redis as never,
    logger as never,
    // Only FRONTEND_URL has a value here; GITLAB_API_URL stays
    // undefined so the gitlab.com default applies in every existing assertion.
    {
      get: jest.fn((key: string) =>
        key === 'FRONTEND_URL' ? 'https://app.example.com' : undefined,
      ),
    } as never,
    grpcClient as never,
    grpcClient as never,
    grpcClient as never,
    {} as never, // repoScanQueue
    entitlementsMock() as never, // entitlements (ENTITLEMENTS_PORT)
    {} as never, // pendingRescans
    {} as never, // repoHistory
  );
  await service.onModuleInit();
  return {
    service,
    integrationRepository,
    repositoryRepository,
    redis,
    logger,
  };
}
