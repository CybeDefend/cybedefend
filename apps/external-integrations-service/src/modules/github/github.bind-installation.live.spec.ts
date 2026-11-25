// The GitHub client packages are ES modules Jest does not load; the binding
// makes no call to GitHub.
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));
jest.mock('@octokit/rest', () => {
  const Octokit = jest.fn();
  return { Octokit: Object.assign(Octokit, { plugin: () => Octokit }) };
});
jest.mock('@octokit/plugin-retry', () => ({ retry: jest.fn() }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: jest.fn() }));

import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from '../../core/db/live-database';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubBranch } from '../../entities/github-branch.entity';
import { GithubService } from './github.service';

/**
 * LIVE spec (both engines): two organizations finish the GitHub App flow
 * for the same installation, recorded by the installation webhook without
 * an organization. Only the database proves that the conditional update
 * binds it once and tells the other caller.
 *
 * Skipped unless GITHUB_BIND_LIVE=1, so `pnpm run test` stays hermetic.
 * Runs once per engine with LIVE_DB_TYPE and the matching
 * GITHUB_BIND_PG_URL / GITHUB_BIND_MYSQL_URL, on a throwaway database built
 * by the service's migration track and dropped at the end.
 */
const describeLive = liveEnabled('GITHUB_BIND') ? describe : describe.skip;

type Binder = {
  bindInstallation(
    integration: GithubIntegration,
    organizationId: string,
    userId: string,
    githubOwner: string | null,
  ): Promise<GithubIntegration>;
};

describeLive(
  'GitHub installation binding on a real database (both engines)',
  () => {
    jest.setTimeout(300_000);

    let db: LiveDatabase;
    let binder: Binder;
    let nextInstallationId = 910_000;

    /** The real method, with only the collaborators it uses. */
    const buildBinder = (): Binder =>
      Object.assign(Object.create(GithubService.prototype), {
        githubIntegrationRepository:
          db.dataSource.getRepository(GithubIntegration),
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }) as Binder;

    /** A row as the installation webhook records it: no organization. */
    const unboundRow = async (): Promise<GithubIntegration> => {
      nextInstallationId += 1;
      return db.dataSource.getRepository(GithubIntegration).save(
        Object.assign(new GithubIntegration(), {
          installationId: nextInstallationId,
          organizationId: null,
          userId: null,
          githubOwner: 'acme',
        }),
      );
    };

    const reload = (id: string) =>
      db.dataSource.getRepository(GithubIntegration).findOneByOrFail({ id });

    beforeAll(async () => {
      db = await createLiveDatabase({
        prefix: 'gh_bind',
        envPrefix: 'GITHUB_BIND',
        entities: [GithubIntegration, GithubRepository, GithubBranch],
      });
      binder = buildBinder();
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('two organizations that both read the unbound row: exactly one binds it, the other answers ALREADY_EXISTS (8 rounds)', async () => {
      for (let round = 0; round < 8; round++) {
        const row = await unboundRow();
        // Both callers hold the row as they read it: still unbound.
        const seenByA = { ...row } as GithubIntegration;
        const seenByB = { ...row } as GithubIntegration;

        const results = await Promise.allSettled([
          binder.bindInstallation(seenByA, 'org-a', 'user-a', 'acme'),
          binder.bindInstallation(seenByB, 'org-b', 'user-b', 'acme'),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason.getError()).toMatchObject({
          code: GrpcStatus.ALREADY_EXISTS,
        });
        const winner = results[0].status === 'fulfilled' ? 'org-a' : 'org-b';
        const stored = await reload(row.id);
        expect(stored.organizationId).toBe(winner);
        expect(stored.userId).toBe(winner === 'org-a' ? 'user-a' : 'user-b');
      }
    });

    it('a caller that read the row before another organization bound it is refused, and the binding stays', async () => {
      const row = await unboundRow();
      const staleView = { ...row } as GithubIntegration;

      await binder.bindInstallation({ ...row }, 'org-a', 'user-a', 'acme');
      await expect(
        binder.bindInstallation(staleView, 'org-b', 'user-b', 'acme'),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: GrpcStatus.ALREADY_EXISTS }),
      });

      const stored = await reload(row.id);
      expect(stored.organizationId).toBe('org-a');
      expect(stored.userId).toBe('user-a');
    });

    it('two callbacks of the same organization both succeed', async () => {
      const row = await unboundRow();

      const results = await Promise.allSettled([
        binder.bindInstallation({ ...row }, 'org-a', 'user-a', 'acme'),
        binder.bindInstallation({ ...row }, 'org-a', 'user-c', 'acme'),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await reload(row.id)).organizationId).toBe('org-a');
    });
  },
);
