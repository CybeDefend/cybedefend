jest.mock('axios');

import axios from 'axios';
import { In, IsNull, Not } from 'typeorm';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { buildGitlabService } from '../../test-utils/gitlab-service.builder';
import { GitlabController } from './gitlab.controller';

const mockedAxios = axios as jest.Mocked<typeof axios>;

const FRESH = new Date(Date.now() + 3_600_000);

function connection(
  overrides: Partial<GitlabIntegration> = {},
): GitlabIntegration {
  return Object.assign(new GitlabIntegration(), {
    id: 'integration-1',
    organizationId: 'org-1',
    accessToken: 'encrypted-access',
    refreshToken: 'encrypted-refresh',
    tokenExpiresAt: FRESH,
    reconnectRequiredAt: null,
    ...overrides,
  });
}

function linkedRepository(
  id: string,
  gitlabId: number,
  webhookId: number,
  integrationId = 'integration-1',
): GitlabRepository {
  return Object.assign(new GitlabRepository(), {
    id,
    gitlabId,
    webhookId,
    integrationId,
    projectId: `project-${id}`,
  });
}

async function setup() {
  const built = await buildGitlabService();
  jest
    .spyOn(
      built.service as unknown as {
        decryptToken: (value: string) => Promise<string | null>;
      },
      'decryptToken',
    )
    .mockResolvedValue('plain-access');
  built.integrationRepository.delete.mockResolvedValue({
    affected: 1,
  } as never);
  built.repositoryRepository.find.mockResolvedValue([]);
  mockedAxios.delete.mockReset().mockResolvedValue({ status: 204 });
  mockedAxios.post.mockReset().mockResolvedValue({ status: 200 });
  return built;
}

type Built = Awaited<ReturnType<typeof setup>>;

/**
 * Answers the two repository reads of a disconnection: the connection's own
 * repositories with a webhook, then (the read filtered on `gitlabId`) the
 * repositories of OTHER connections that reference the same hooks.
 */
function repositoriesFound(
  repositoryRepository: Built['repositoryRepository'],
  linked: GitlabRepository[] | ((integrationId: string) => GitlabRepository[]),
  usedElsewhere: Array<Pick<GitlabRepository, 'gitlabId' | 'webhookId'>> = [],
): void {
  repositoryRepository.find.mockImplementation(async (options) => {
    const where = (
      options as { where: { gitlabId?: unknown; integrationId: unknown } }
    ).where;
    if (where.gitlabId !== undefined) return usedElsewhere;
    return typeof linked === 'function'
      ? linked(where.integrationId as string)
      : linked;
  });
}

const loggedLines = (logger: {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}) =>
  JSON.stringify([
    logger.log.mock.calls,
    logger.warn.mock.calls,
    logger.error.mock.calls,
  ]);

describe('GitlabService.disconnect', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['an empty', ''],
    ['an undefined', undefined],
    ['a null', null],
  ])(
    'refuses %s organization id with INVALID_ARGUMENT and touches nothing',
    async (_label, organizationId) => {
      const { service, integrationRepository, repositoryRepository } =
        await setup();

      await expect(
        service.disconnect(organizationId as never),
      ).rejects.toMatchObject({
        error: expect.objectContaining({
          message: 'organizationId is required',
          code: GrpcStatus.INVALID_ARGUMENT,
        }),
      });

      expect(integrationRepository.find).not.toHaveBeenCalled();
      expect(repositoryRepository.find).not.toHaveBeenCalled();
      expect(integrationRepository.delete).not.toHaveBeenCalled();
      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    },
  );

  it('answers success without calling GitLab when the organization has no GitLab', async () => {
    const { service, integrationRepository } = await setup();
    integrationRepository.find.mockResolvedValue([]);

    await expect(service.disconnect('org-1')).resolves.toEqual({
      success: true,
      message: 'GitLab integration disconnected',
    });

    expect(mockedAxios.delete).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(integrationRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes our webhooks, revokes the token, then removes the connection', async () => {
    const { service, integrationRepository, repositoryRepository, logger } =
      await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    repositoriesFound(repositoryRepository, [
      linkedRepository('r1', 101, 11),
      linkedRepository('r2', 102, 12),
    ]);

    await expect(service.disconnect('org-1')).resolves.toEqual({
      success: true,
      message: 'GitLab integration disconnected',
    });

    expect(integrationRepository.find).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
    });
    expect(repositoryRepository.find).toHaveBeenCalledWith({
      where: { integrationId: 'integration-1', webhookId: Not(IsNull()) },
    });
    for (const [gitlabId, webhookId] of [
      [101, 11],
      [102, 12],
    ]) {
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        `https://gitlab.com/api/v4/projects/${gitlabId}/hooks/${webhookId}`,
        { headers: { Authorization: 'Bearer plain-access' }, timeout: 10_000 },
      );
    }
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://gitlab.com/oauth/revoke',
      expect.any(URLSearchParams),
      { timeout: 10_000 },
    );
    const revokeParams = mockedAxios.post.mock.calls[0][1] as URLSearchParams;
    expect(revokeParams.get('token')).toBe('plain-access');
    expect(revokeParams.get('client_id')).toBe('app');
    expect(integrationRepository.delete).toHaveBeenCalledWith({
      id: In(['integration-1']),
    });

    const lastWebhookCall = Math.max(
      ...mockedAxios.delete.mock.invocationCallOrder,
    );
    const revokeCall = mockedAxios.post.mock.invocationCallOrder[0];
    const deleteRowsCall =
      integrationRepository.delete.mock.invocationCallOrder[0];
    expect(lastWebhookCall).toBeLessThan(revokeCall);
    expect(revokeCall).toBeLessThan(deleteRowsCall);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'GITLAB_DISCONNECTED org=org-1 integrations=1 webhooks_deleted=2 webhooks_failed=0 webhooks_skipped=0 webhooks_shared=0 tokens_revoked=1',
      ),
      'GitlabService',
    );
    expect(loggedLines(logger)).not.toContain('plain-access');
  });

  it('still disconnects when GitLab fails to delete webhooks or to revoke the token', async () => {
    const { service, integrationRepository, repositoryRepository, logger } =
      await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    repositoriesFound(repositoryRepository, [
      linkedRepository('r1', 101, 11),
      linkedRepository('r2', 102, 12),
    ]);
    mockedAxios.delete
      .mockRejectedValueOnce({
        message: 'Request failed with status code 500',
        response: { status: 500 },
      })
      .mockRejectedValueOnce({
        message: 'timeout of 10000ms exceeded',
        code: 'ECONNABORTED',
      });
    mockedAxios.post.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(service.disconnect('org-1')).resolves.toMatchObject({
      success: true,
    });

    expect(integrationRepository.delete).toHaveBeenCalledWith({
      id: In(['integration-1']),
    });
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'webhooks_deleted=0 webhooks_failed=2 webhooks_skipped=0 webhooks_shared=0 tokens_revoked=0',
      ),
      'GitlabService',
    );
    expect(loggedLines(logger)).not.toContain('plain-access');
  });

  it('counts a webhook GitLab no longer has (404) as deleted', async () => {
    const { service, integrationRepository, repositoryRepository, logger } =
      await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    repositoriesFound(repositoryRepository, [linkedRepository('r1', 101, 11)]);
    mockedAxios.delete.mockRejectedValueOnce({
      message: 'Not Found',
      response: { status: 404 },
    });

    await service.disconnect('org-1');

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('webhooks_deleted=1 webhooks_failed=0'),
      'GitlabService',
    );
  });

  it('starts no webhook deletion past its 20 s budget, and disconnects anyway', async () => {
    const { service, integrationRepository, repositoryRepository, logger } =
      await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    repositoriesFound(
      repositoryRepository,
      Array.from({ length: 7 }, (_, index) =>
        linkedRepository(`r${index}`, 100 + index, 10 + index),
      ),
    );
    let clock = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    mockedAxios.delete.mockImplementation(
      () =>
        new Promise((resolve) =>
          setImmediate(() => {
            clock += 21_000;
            resolve({ status: 204 });
          }),
        ),
    );

    await expect(service.disconnect('org-1')).resolves.toMatchObject({
      success: true,
    });

    expect(mockedAxios.delete).toHaveBeenCalledTimes(5);
    expect(integrationRepository.delete).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'webhooks_deleted=5 webhooks_failed=0 webhooks_skipped=2 webhooks_shared=0',
      ),
      'GitlabService',
    );
  });

  it('leaves in place a webhook another organization still relies on, and counts it shared', async () => {
    const { service, integrationRepository, repositoryRepository, logger } =
      await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    repositoriesFound(
      repositoryRepository,
      [linkedRepository('r1', 101, 11), linkedRepository('r2', 102, 12)],
      // Another organization links project 101 through the SAME hook, and
      // project 102 through a hook of its own.
      [
        { gitlabId: 101, webhookId: 11 },
        { gitlabId: 102, webhookId: 99 },
      ],
    );

    await expect(service.disconnect('org-1')).resolves.toMatchObject({
      success: true,
    });

    expect(repositoryRepository.find).toHaveBeenCalledWith({
      where: {
        gitlabId: In([101, 102]),
        webhookId: Not(IsNull()),
        integrationId: Not(In(['integration-1'])),
      },
      select: { gitlabId: true, webhookId: true },
    });
    expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/102/hooks/12',
      expect.anything(),
    );
    expect(integrationRepository.delete).toHaveBeenCalledWith({
      id: In(['integration-1']),
    });
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'webhooks_deleted=1 webhooks_failed=0 webhooks_skipped=0 webhooks_shared=1 tokens_revoked=1',
      ),
      'GitlabService',
    );
  });

  it('still deletes a hook that only the connections being disconnected reference', async () => {
    const { service, integrationRepository, repositoryRepository, logger } =
      await setup();
    integrationRepository.find.mockResolvedValue([
      connection({ id: 'integration-1' }),
      connection({ id: 'integration-2' }),
    ]);
    // Both rows of the organization point at the same hook of project 101.
    repositoriesFound(repositoryRepository, (integrationId) => [
      linkedRepository(`r-${integrationId}`, 101, 11, integrationId),
    ]);

    await service.disconnect('org-1');

    for (const integrationId of ['integration-1', 'integration-2']) {
      expect(repositoryRepository.find).toHaveBeenCalledWith({
        where: { integrationId, webhookId: Not(IsNull()) },
      });
    }
    expect(repositoryRepository.find).toHaveBeenCalledWith({
      where: {
        gitlabId: In([101]),
        webhookId: Not(IsNull()),
        integrationId: Not(In(['integration-1', 'integration-2'])),
      },
      select: { gitlabId: true, webhookId: true },
    });
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/101/hooks/11',
      expect.anything(),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('webhooks_shared=0'),
      'GitlabService',
    );
  });

  it('reads no other connection when this one has no webhook', async () => {
    const { service, integrationRepository, repositoryRepository } =
      await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    repositoriesFound(repositoryRepository, []);

    await service.disconnect('org-1');

    expect(repositoryRepository.find).toHaveBeenCalledTimes(1);
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('touches nothing on GitLab for a connection GitLab already refused', async () => {
    const { service, integrationRepository, repositoryRepository } =
      await setup();
    integrationRepository.find.mockResolvedValue([
      connection({ reconnectRequiredAt: new Date('2026-10-14T08:00:00Z') }),
    ]);

    await expect(service.disconnect('org-1')).resolves.toMatchObject({
      success: true,
    });

    expect(repositoryRepository.find).not.toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(integrationRepository.delete).toHaveBeenCalledWith({
      id: In(['integration-1']),
    });
  });

  it('touches nothing on GitLab when no token can be obtained', async () => {
    const { service, integrationRepository } = await setup();
    integrationRepository.find.mockResolvedValue([connection()]);
    jest
      .spyOn(
        service as unknown as {
          getRefreshedAccessToken: (
            row: GitlabIntegration,
          ) => Promise<string | null>;
        },
        'getRefreshedAccessToken',
      )
      .mockResolvedValue(null);

    await expect(service.disconnect('org-1')).resolves.toMatchObject({
      success: true,
    });

    expect(mockedAxios.delete).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(integrationRepository.delete).toHaveBeenCalledWith({
      id: In(['integration-1']),
    });
  });

  it('handles every connection of an organization that holds two', async () => {
    const { service, integrationRepository, repositoryRepository } =
      await setup();
    integrationRepository.find.mockResolvedValue([
      connection({ id: 'integration-1' }),
      connection({ id: 'integration-2' }),
    ]);
    repositoriesFound(repositoryRepository, (integrationId) =>
      integrationId === 'integration-2'
        ? [linkedRepository('r9', 109, 19, 'integration-2')]
        : [],
    );

    await service.disconnect('org-1');

    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/109/hooks/19',
      expect.anything(),
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(integrationRepository.delete).toHaveBeenCalledWith({
      id: In(['integration-1', 'integration-2']),
    });
  });

  it('answers INTERNAL when the connection rows cannot be deleted', async () => {
    const { service, integrationRepository } = await setup();
    integrationRepository.find.mockResolvedValue([
      connection({ reconnectRequiredAt: new Date() }),
    ]);
    integrationRepository.delete.mockRejectedValue(
      new Error('Lock wait timeout exceeded'),
    );

    await expect(service.disconnect('org-1')).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.INTERNAL }),
    });
  });
});

describe('GitlabController.disconnect', () => {
  it('hands the organization of the request to the service', async () => {
    const gitlabService = {
      disconnect: jest.fn().mockResolvedValue({
        success: true,
        message: 'GitLab integration disconnected',
      }),
    };
    const controller = new GitlabController(
      gitlabService as never,
      { log: jest.fn() } as never,
    );

    await expect(
      controller.disconnect({ organizationId: 'org-1' }),
    ).resolves.toEqual({
      success: true,
      message: 'GitLab integration disconnected',
    });
    expect(gitlabService.disconnect).toHaveBeenCalledWith('org-1');
  });
});
