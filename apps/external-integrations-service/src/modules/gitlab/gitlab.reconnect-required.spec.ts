jest.mock('axios');

import axios from 'axios';
import { IsNull } from 'typeorm';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { buildGitlabService } from '../../test-utils/gitlab-service.builder';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function connection(
  overrides: Partial<GitlabIntegration> = {},
): GitlabIntegration {
  return Object.assign(new GitlabIntegration(), {
    id: 'integration-1',
    organizationId: 'org-1',
    userId: 'user-1',
    gitlabUserId: 42,
    gitlabGroupId: null,
    accessToken: 'encrypted-access',
    refreshToken: 'encrypted-refresh-sent',
    tokenExpiresAt: new Date(0),
    reconnectRequiredAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  });
}

describe('GitlabService.getInstallationForOrga reconnectRequired', () => {
  it('says a connection whose refresh GitLab refused needs reconnecting', async () => {
    const { service, integrationRepository } = await buildGitlabService();
    integrationRepository.findOne.mockResolvedValue(
      connection({ reconnectRequiredAt: new Date('2026-10-14T08:00:00Z') }),
    );

    await expect(
      service.getInstallationForOrga('org-1'),
    ).resolves.toMatchObject({
      id: 'integration-1',
      reconnectRequired: true,
    });
  });

  it('says a healthy connection does not', async () => {
    const { service, integrationRepository } = await buildGitlabService();
    integrationRepository.findOne.mockResolvedValue(connection());

    await expect(
      service.getInstallationForOrga('org-1'),
    ).resolves.toMatchObject({
      id: 'integration-1',
      reconnectRequired: false,
    });
  });

  it('answers false for an organization without GitLab', async () => {
    const { service, integrationRepository } = await buildGitlabService();
    integrationRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getInstallationForOrga('org-1'),
    ).resolves.toMatchObject({
      id: '',
      reconnectRequired: false,
    });
  });
});

describe('GitlabService.refreshAccessToken connection state', () => {
  const refusedRefresh = (status: number, data?: unknown) => ({
    message: `Request failed with status code ${status}`,
    response: { status, data },
  });

  async function setup(stored: GitlabIntegration = connection()) {
    const built = await buildGitlabService();
    built.integrationRepository.findOne.mockResolvedValue(stored);
    built.integrationRepository.update.mockResolvedValue({
      affected: 1,
    } as never);
    built.integrationRepository.save.mockImplementation(
      async (row) => row as never,
    );
    jest
      .spyOn(
        built.service as unknown as {
          decryptToken: (value: string) => Promise<string | null>;
        },
        'decryptToken',
      )
      .mockResolvedValue('plain-refresh');
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockImplementation(
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'response' in error,
    );
    const refresh = (row: GitlabIntegration) =>
      (
        built.service as unknown as {
          refreshAccessToken: (row: GitlabIntegration) => Promise<string>;
        }
      ).refreshAccessToken(row);
    return { ...built, refresh };
  }

  it.each([400, 401])(
    'marks the connection when GitLab answers %i invalid_grant, and still answers UNAUTHENTICATED',
    async (status) => {
      const { integrationRepository, refresh } = await setup();
      mockedAxios.post.mockRejectedValueOnce(
        refusedRefresh(status, { error: 'invalid_grant' }),
      );

      await expect(refresh(connection())).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.UNAUTHENTICATED }),
      });

      expect(integrationRepository.update).toHaveBeenCalledWith(
        {
          id: 'integration-1',
          refreshToken: 'encrypted-refresh-sent',
          reconnectRequiredAt: IsNull(),
        },
        { reconnectRequiredAt: expect.any(Date) },
      );
    },
  );

  it.each([
    ['400 invalid_client', refusedRefresh(400, { error: 'invalid_client' })],
    ['429', refusedRefresh(429)],
    ['500', refusedRefresh(500)],
    ['502', refusedRefresh(502)],
    ['503', refusedRefresh(503)],
    ['504', refusedRefresh(504)],
    ['a network error', new Error('socket hang up')],
    [
      'a timeout',
      { message: 'timeout of 10000ms exceeded', code: 'ECONNABORTED' },
    ],
  ])('does not mark the connection on %s', async (_label, error) => {
    const { integrationRepository, refresh } = await setup();
    mockedAxios.post.mockRejectedValueOnce(error);

    await expect(refresh(connection())).rejects.toBeDefined();

    expect(integrationRepository.update).not.toHaveBeenCalled();
  });

  it('does not mark the connection when its own refresh token cannot be decrypted', async () => {
    const { service, integrationRepository, refresh } = await setup();
    jest
      .spyOn(
        service as unknown as {
          decryptToken: (value: string) => Promise<string | null>;
        },
        'decryptToken',
      )
      .mockResolvedValue(null);

    await expect(refresh(connection())).rejects.toMatchObject({
      error: expect.objectContaining({ code: GrpcStatus.UNAUTHENTICATED }),
    });

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(integrationRepository.update).not.toHaveBeenCalled();
  });

  it('gives GitLab 10 s to answer the refresh', async () => {
    const { refresh } = await setup();
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 7200,
      },
    });

    await expect(refresh(connection())).resolves.toBe('new-access');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://gitlab.com/oauth/token',
      expect.any(URLSearchParams),
      { timeout: 10_000 },
    );
  });

  it('clears the mark once a refresh succeeds', async () => {
    const { integrationRepository, refresh } = await setup(
      connection({ reconnectRequiredAt: new Date('2026-10-14T08:00:00Z') }),
    );
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 7200,
      },
    });

    await expect(refresh(connection())).resolves.toBe('new-access');

    expect(integrationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ reconnectRequiredAt: null }),
    );
  });
});

describe('GitlabService reinstall clears the mark', () => {
  it('a new OAuth install on a marked connection makes it healthy again', async () => {
    const { service, integrationRepository } = await buildGitlabService();
    integrationRepository.findOne.mockResolvedValue(
      connection({ reconnectRequiredAt: new Date('2026-10-14T08:00:00Z') }),
    );
    integrationRepository.save.mockImplementation(async (row) => row as never);

    await (
      service as unknown as {
        createOrUpdateIntegration: (
          organizationId: string,
          userId: string,
          gitlabUser: { id: number },
          tokenResponse: {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            scope: string;
          },
        ) => Promise<GitlabIntegration>;
      }
    ).createOrUpdateIntegration(
      'org-1',
      'user-2',
      { id: 7 },
      {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 7200,
        scope: 'api',
      },
    );

    expect(integrationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ reconnectRequiredAt: null }),
    );
  });
});
