import { ident, run, sql } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from '../../core/db/live-database';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { GitlabRepository } from '../../entities/gitlab-repository.entity';
import { GitlabBranch } from '../../entities/gitlab-branch.entity';
import { GitlabService } from './gitlab.service';
import { flagReconnectRequired } from './gitlab-reconnect';

/**
 * LIVE spec (both engines) against a REAL
 * database: only the database proves that deleting a connection cascades to
 * its repository links and branches, and that the reconnect mark is
 * conditional on the refresh token still stored.
 *
 * Skipped unless GITLAB_DISCONNECT_LIVE=1 (or the legacy
 * GITLAB_DISCONNECT_MYSQL_LIVE=1, which means LIVE_DB_TYPE=mysql), so
 * `pnpm run test` stays hermetic. Runs once per engine with LIVE_DB_TYPE and
 * the matching GITLAB_DISCONNECT_PG_URL / GITLAB_DISCONNECT_MYSQL_URL. It
 * creates a throwaway database through the service's real migration track,
 * and drops the database at the end.
 */
const describeLive = liveEnabled('GITLAB_DISCONNECT')
  ? describe
  : describe.skip;

describeLive('GitLab disconnection on a real database (both engines)', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;
  let service: GitlabService;
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  async function insertConnection(
    organizationId: string,
    refreshToken = 'enc-refresh',
  ): Promise<GitlabIntegration> {
    return db.dataSource.getRepository(GitlabIntegration).save(
      Object.assign(new GitlabIntegration(), {
        organizationId,
        userId: 'user-1',
        gitlabUserId: 1,
        accessToken: 'enc-access',
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        // A refused connection: disconnect makes no call to GitLab.
        reconnectRequiredAt: new Date(),
      }),
    );
  }

  async function insertRepository(
    integrationId: string,
    gitlabId: number,
    projectId: string | null,
  ): Promise<GitlabRepository> {
    const repository = await db.dataSource.getRepository(GitlabRepository).save(
      Object.assign(new GitlabRepository(), {
        gitlabId,
        name: `repo-${gitlabId}`,
        nameWithNamespace: `group / repo-${gitlabId}`,
        path: `repo-${gitlabId}`,
        pathWithNamespace: `group/repo-${gitlabId}`,
        private: true,
        description: '',
        webUrl: `https://gitlab.com/group/repo-${gitlabId}`,
        sshUrlToRepo: `git@gitlab.com:group/repo-${gitlabId}.git`,
        httpUrlToRepo: `https://gitlab.com/group/repo-${gitlabId}.git`,
        projectId,
        webhookId: gitlabId,
        integrationId,
      }),
    );
    await db.dataSource.getRepository(GitlabBranch).save(
      Object.assign(new GitlabBranch(), {
        name: 'main',
        isProtected: true,
        repositoryId: repository.id,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      }),
    );
    return repository;
  }

  const count = async (
    table: string,
    column: string,
    value: string,
  ): Promise<number> => {
    const { rows } = await run(
      db.dataSource,
      sql`SELECT COUNT(*) AS cnt FROM ${ident(table)} WHERE ${ident(column)} = ${value}`,
    );
    return Number(rows[0].cnt);
  };

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'gl_disconnect',
      envPrefix: 'GITLAB_DISCONNECT',
      entities: [GitlabIntegration, GitlabRepository, GitlabBranch],
    });

    const grpcClient = { getService: () => ({}) };
    service = new GitlabService(
      db.dataSource.getRepository(GitlabIntegration),
      db.dataSource.getRepository(GitlabRepository),
      db.dataSource.getRepository(GitlabBranch),
      db.dataSource,
      { getSecret: async () => 'unused' } as never,
      {} as never,
      logger as never,
      { get: () => 'https://app.example.com' } as never,
      grpcClient as never,
      grpcClient as never,
      grpcClient as never,
      {} as never, // repoScanQueue
      {} as never, // billingWritable
      {} as never, // pendingRescans
      {} as never, // repoHistory
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("removes the organization's repository links and branches, and nobody else's", async () => {
    const own = await insertConnection('org-a');
    const ownRepositories = [
      await insertRepository(own.id, 1001, 'project-1'),
      await insertRepository(own.id, 1002, null),
    ];
    const other = await insertConnection('org-b');
    await insertRepository(other.id, 2001, 'project-2');

    await expect(service.disconnect('org-a')).resolves.toMatchObject({
      success: true,
    });

    expect(await count('gitlab_integrations', 'organizationId', 'org-a')).toBe(
      0,
    );
    expect(await count('gitlab_repositories', 'integrationId', own.id)).toBe(0);
    const { rows: branchRows } = await run(
      db.dataSource,
      sql`SELECT COUNT(*) AS cnt FROM ${ident('gitlab_branches')} WHERE ${ident('repositoryId')} IN (${ownRepositories[0].id}, ${ownRepositories[1].id})`,
    );
    expect(Number(branchRows[0].cnt)).toBe(0);
    expect(await count('gitlab_integrations', 'organizationId', 'org-b')).toBe(
      1,
    );
    expect(await count('gitlab_repositories', 'integrationId', other.id)).toBe(
      1,
    );
  });

  it('marks a connection only while it still holds the refused refresh token', async () => {
    const row = await insertConnection('org-c', 'current-token');
    await run(
      db.dataSource,
      sql`UPDATE ${ident('gitlab_integrations')} SET ${ident('reconnectRequiredAt')} = NULL WHERE ${ident('id')} = ${row.id}`,
    );
    const repository = db.dataSource.getRepository(GitlabIntegration);

    await flagReconnectRequired(repository, logger, row, 'rotated-away-token');
    expect(
      (await repository.findOneByOrFail({ id: row.id })).reconnectRequiredAt,
    ).toBeNull();

    await flagReconnectRequired(repository, logger, row, 'current-token');
    expect(
      (await repository.findOneByOrFail({ id: row.id })).reconnectRequiredAt,
    ).toBeInstanceOf(Date);
  });

  it('keeps the first timestamp of a connection already marked, and logs nothing', async () => {
    const row = await insertConnection('org-d', 'current-token');
    await run(
      db.dataSource,
      sql`UPDATE ${ident('gitlab_integrations')} SET ${ident('reconnectRequiredAt')} = ${new Date('2026-10-01T08:00:00.000Z')} WHERE ${ident('id')} = ${row.id}`,
    );
    const repository = db.dataSource.getRepository(GitlabIntegration);
    logger.warn.mockClear();

    await flagReconnectRequired(repository, logger, row, 'current-token');

    expect(
      (
        await repository.findOneByOrFail({ id: row.id })
      ).reconnectRequiredAt?.toISOString(),
    ).toBe('2026-10-01T08:00:00.000Z');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
