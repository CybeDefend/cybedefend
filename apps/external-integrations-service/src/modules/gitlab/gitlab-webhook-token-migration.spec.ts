jest.mock('./gitlab.service', () => ({ GitlabService: class {} }));

import { IsNull, MoreThan } from 'typeorm';
import { GitlabWebhookTokenMigration } from './gitlab-webhook-token-migration';

type Outcome = 'rotated' | 'no_hook' | 'failed';

/**
 * A repository double holding `gitlab_repositories` rows; `find` honours the
 * keyset query the migration sends, and `rotateWebhookToken` sets the hash
 * on every row of the project unless the outcome is `failed`.
 */
function setup(
  rows: Array<{ id: string; gitlabId: number; webhookTokenHash?: string }>,
  outcomes: Record<number, Outcome> = {},
) {
  const table = rows.map((r) => ({ webhookTokenHash: null, ...r }));
  const repository = {
    find: jest.fn(async (options: any) => {
      const cursor = options.where.gitlabId.value as number;
      return table
        .filter((r) => r.webhookTokenHash === null && r.gitlabId > cursor)
        .sort((a, b) => a.gitlabId - b.gitlabId)
        .slice(0, options.take)
        .map(({ id, gitlabId }) => ({ id, gitlabId }));
    }),
    count: jest.fn(
      async () => table.filter((r) => r.webhookTokenHash === null).length,
    ),
  };
  const gitlab = {
    rotateWebhookToken: jest.fn(async (gitlabId: number) => {
      const outcome = outcomes[gitlabId] ?? 'rotated';
      if (outcome !== 'failed') {
        for (const r of table) {
          if (r.gitlabId === gitlabId) r.webhookTokenHash = 'h'.repeat(64);
        }
      }
      return outcome;
    }),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const migration = new GitlabWebhookTokenMigration(
    repository as never,
    gitlab as never,
    logger as never,
  );
  const sleep = jest.fn(async () => undefined);
  migration.sleep = sleep;
  return { migration, repository, gitlab, logger, sleep, table };
}

describe('GitlabWebhookTokenMigration', () => {
  it('rotates the token of each GitLab project once, however many rows track it', async () => {
    const { migration, gitlab } = setup([
      { id: 'a', gitlabId: 3 },
      { id: 'b', gitlabId: 1 },
      { id: 'c', gitlabId: 3 },
      { id: 'd', gitlabId: 2 },
    ]);

    const counts = await migration.run();

    expect(gitlab.rotateWebhookToken.mock.calls.map((c) => c[0])).toEqual([
      1, 2, 3,
    ]);
    expect(counts).toEqual({
      projects: 3,
      rotated: 3,
      noHook: 0,
      failed: 0,
      remaining: 0,
    });
  });

  it('only selects rows without a hash, through a keyset on gitlabId', async () => {
    const { migration, repository } = setup([{ id: 'a', gitlabId: 1 }]);

    await migration.run();

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { webhookTokenHash: IsNull(), gitlabId: MoreThan(0) },
        order: { gitlabId: 'ASC' },
      }),
    );
  });

  it('skips the projects already migrated (idempotent: a second run does nothing)', async () => {
    const { migration, gitlab } = setup([
      { id: 'a', gitlabId: 1, webhookTokenHash: 'h'.repeat(64) },
      { id: 'b', gitlabId: 2 },
    ]);

    await migration.run();
    expect(gitlab.rotateWebhookToken.mock.calls.map((c) => c[0])).toEqual([2]);

    gitlab.rotateWebhookToken.mockClear();
    const again = await migration.run();
    expect(gitlab.rotateWebhookToken).not.toHaveBeenCalled();
    expect(again.projects).toBe(0);
  });

  it('moves past a failed project instead of retrying it forever, and reports it as remaining', async () => {
    const { migration, gitlab } = setup(
      [
        { id: 'a', gitlabId: 1 },
        { id: 'b', gitlabId: 2 },
        { id: 'c', gitlabId: 3 },
      ],
      { 2: 'failed', 3: 'no_hook' },
    );

    const counts = await migration.run();

    expect(gitlab.rotateWebhookToken).toHaveBeenCalledTimes(3);
    expect(counts).toEqual({
      projects: 3,
      rotated: 1,
      noHook: 1,
      failed: 1,
      remaining: 1,
    });
  });

  it('walks every batch', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: `r${i}`,
      gitlabId: i + 1,
    }));
    const { migration, gitlab, repository } = setup(rows, { 4: 'failed' });
    migration.batchSize = 3;

    const counts = await migration.run();

    expect(gitlab.rotateWebhookToken).toHaveBeenCalledTimes(7);
    expect(repository.find.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(counts.rotated).toBe(6);
  });

  it('pauses between projects to stay under the GitLab rate limits', async () => {
    const { migration, sleep } = setup([
      { id: 'a', gitlabId: 1 },
      { id: 'b', gitlabId: 2 },
    ]);
    migration.pauseMs = 123;

    await migration.run();

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(123);
  });

  it('logs counts only', async () => {
    const { migration, logger } = setup([{ id: 'a', gitlabId: 1 }]);

    await migration.run();

    const lines = logger.log.mock.calls.map((c) => String(c[0]));
    expect(lines.at(-1)).toBe(
      'GITLAB_WEBHOOK_TOKEN_MIGRATION done projects=1 rotated=1 no_hook=0 failed=0 remaining=0',
    );
  });
});
