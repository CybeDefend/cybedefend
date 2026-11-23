import { ident, run, sql } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveEnabled,
  LiveDatabase,
} from '../../core/db/live-database';
import { GithubBranch } from '../../entities/github-branch.entity';
import { GithubRepository } from '../../entities/github-repository.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { deleteStaleBranches, upsertBranches } from './branch-upsert.util';

/**
 * LIVE spec against a real
 * MySQL and a real PostgreSQL.
 *
 * The unit spec proves which query builder calls are made; only the database
 * proves what they turn into: how many statements reach the server, that no
 * SELECT follows them (`updateEntity(false)`), that a conflicting row is
 * updated in place (same id, new `isProtected`), that a new row gets its id
 * and its timestamps, that the orphan delete keys on the quoted
 * `"repositoryId"` column (PostgreSQL folds a bare camelCase identifier to
 * lower case), and that branch names are case-sensitive on PostgreSQL and
 * collide on MySQL's case-insensitive collation.
 *
 * Skipped unless BRANCH_UPSERT_LIVE=1 (or the legacy BRANCH_UPSERT_MYSQL_LIVE=1,
 * which means LIVE_DB_TYPE=mysql). Runs once per engine:
 *   BRANCH_UPSERT_LIVE=1 LIVE_DB_TYPE=postgres BRANCH_UPSERT_PG_URL=postgres://… \
 *     pnpm exec jest branch-upsert.util.live --runInBand
 * It creates, then drops, its own throwaway database; it never touches the
 * `cybedefend_*` ones.
 */
const describeLive = liveEnabled('BRANCH_UPSERT') ? describe : describe.skip;

const REPO_1 = '00000000-0000-0000-0000-0000000000a1';
const OTHER_REPO = '00000000-0000-0000-0000-0000000000a2';
const REPO_C = '00000000-0000-0000-0000-0000000000a3';

describeLive('upsertBranches on a live database (both engines)', () => {
  jest.setTimeout(300_000);

  let db: LiveDatabase;

  beforeAll(async () => {
    db = await createLiveDatabase({
      prefix: 'ei_l14_branch_upsert',
      envPrefix: 'BRANCH_UPSERT',
      entities: [GithubBranch, GithubRepository, GithubIntegration],
    });
    const ds = db.dataSource;
    await run(
      ds,
      sql`INSERT INTO ${ident('github_integrations')} (${ident('id')}, ${ident('installationId')}, ${ident('organizationId')}) VALUES (${'00000000-0000-0000-0000-0000000000i1'}, ${7}, ${'org-live'})`,
    );
    await run(
      ds,
      sql`INSERT INTO ${ident('github_repositories')} (${ident('id')}, ${ident('githubId')}, ${ident('nodeId')}, ${ident('name')}, ${ident('fullName')}, ${ident('private')}, ${ident('integrationId')}) VALUES
        (${REPO_1}, ${101}, ${'n-101'}, ${'repo-1'}, ${'org/repo-1'}, ${true}, ${'00000000-0000-0000-0000-0000000000i1'}),
        (${OTHER_REPO}, ${102}, ${'n-102'}, ${'other-repo'}, ${'org/other'}, ${true}, ${'00000000-0000-0000-0000-0000000000i1'}),
        (${REPO_C}, ${103}, ${'n-103'}, ${'repo-c'}, ${'org/repo-c'}, ${false}, ${'00000000-0000-0000-0000-0000000000i1'})`,
    );
    // Two existing rows of repo-1 and one of the other repo.
    await run(
      ds,
      sql`INSERT INTO ${ident('github_branches')} (${ident('id')}, ${ident('name')}, ${ident('isProtected')}, ${ident('repositoryId')}, ${ident('firstSeenAt')}) VALUES
        (${'00000000-0000-0000-0000-000000000000'}, ${'b0'}, ${false}, ${REPO_1}, ${new Date('2026-01-01T00:00:00.000Z')}),
        (${'00000000-0000-0000-0000-000000000001'}, ${'b1'}, ${true}, ${REPO_1}, ${new Date('2026-01-01T00:00:00.000Z')}),
        (${'00000000-0000-0000-0000-000000000002'}, ${'b0'}, ${true}, ${OTHER_REPO}, ${new Date('2026-01-01T00:00:00.000Z')})`,
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  async function namesOf(repositoryId: string): Promise<string[]> {
    const { rows } = await run(
      db.dataSource,
      sql`SELECT ${ident('name')} FROM ${ident('github_branches')} WHERE ${ident('repositoryId')} = ${repositoryId} ORDER BY ${ident('name')}`,
    );
    return rows.map((r) => String(r.name));
  }

  async function countOf(repositoryId: string): Promise<number> {
    const { rows } = await run(
      db.dataSource,
      sql`SELECT COUNT(*) AS cnt FROM ${ident('github_branches')} WHERE ${ident('repositoryId')} = ${repositoryId}`,
    );
    return Number(rows[0].cnt);
  }

  it('writes 1 200 branches in 3 INSERT statements, updates the existing rows in place, reads nothing back', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      repositoryId: REPO_1,
      name: `b${i}`,
      isProtected: i % 2 === 0,
    }));

    db.statements.length = 0;
    const issued = await db.dataSource.transaction((manager) =>
      upsertBranches(manager, GithubBranch, rows),
    );
    const sent = db.statements.filter(
      (q) => !/^(START TRANSACTION|BEGIN|COMMIT|ROLLBACK)/i.test(q.trim()),
    );

    expect(issued).toBe(3);
    expect(sent).toHaveLength(3);
    for (const statement of sent) {
      expect(statement).toMatch(/^INSERT INTO/i);
      expect(statement).toContain('github_branches');
      // MySQL: ON DUPLICATE KEY UPDATE; PostgreSQL: ON CONFLICT (…) DO UPDATE.
      if (db.dialect === 'mysql') {
        expect(statement).toContain('ON DUPLICATE KEY UPDATE');
      } else {
        expect(statement).toMatch(/ON CONFLICT/i);
      }
    }
    expect(sent.some((q) => /^\s*SELECT/i.test(q))).toBe(false);

    expect(await countOf(REPO_1)).toBe(1200);

    // Existing rows: same id and firstSeenAt, isProtected from the new list.
    const { rows: existing } = await run(
      db.dataSource,
      sql`SELECT ${ident('id')}, ${ident('isProtected')}, ${ident('firstSeenAt')} FROM ${ident('github_branches')} WHERE ${ident('repositoryId')} = ${REPO_1} AND ${ident('name')} IN (${'b0'}, ${'b1'}) ORDER BY ${ident('name')}`,
    );
    expect(existing.map((r) => r.id)).toEqual([
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000001',
    ]);
    expect(existing.map((r) => Number(r.isProtected))).toEqual([1, 0]);
    expect(
      existing.map((r) =>
        new Date(r.firstSeenAt as Date).toISOString().slice(0, 10),
      ),
    ).toEqual(['2026-01-01', '2026-01-01']);

    // A new row: a generated uuid and its database defaults.
    const { rows: freshRows } = await run(
      db.dataSource,
      sql`SELECT ${ident('id')}, ${ident('isProtected')}, ${ident('firstSeenAt')}, ${ident('createdAt')} FROM ${ident('github_branches')} WHERE ${ident('repositoryId')} = ${REPO_1} AND ${ident('name')} = ${'b1199'}`,
    );
    const [fresh] = freshRows;
    expect(fresh.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(fresh.isProtected)).toBe(0);
    expect(fresh.firstSeenAt).toBeTruthy();
    expect(fresh.createdAt).toBeTruthy();

    // Another repository's row with the same name is untouched.
    expect(await namesOf(OTHER_REPO)).toEqual(['b0']);
    const { rows: otherRows } = await run(
      db.dataSource,
      sql`SELECT ${ident('isProtected')} FROM ${ident('github_branches')} WHERE ${ident('repositoryId')} = ${OTHER_REPO}`,
    );
    expect(Number(otherRows[0].isProtected)).toBe(1);
  });

  it('stale branches are removed by name on both engines', async () => {
    // repo-1 currently holds b0…b1199; keep only b0 and b2.
    const kept = await db.dataSource.transaction((manager) =>
      deleteStaleBranches(manager, GithubBranch, REPO_1, ['b0', 'b2']),
    );
    expect(Number(kept.affected)).toBe(1198);
    expect(await namesOf(REPO_1)).toEqual(['b0', 'b2']);
    // The other repository's branches are untouched.
    expect(await namesOf(OTHER_REPO)).toEqual(['b0']);

    // An empty keep list drops every row of the repository.
    const all = await db.dataSource.transaction((manager) =>
      deleteStaleBranches(manager, GithubBranch, REPO_1, []),
    );
    expect(Number(all.affected)).toBe(2);
    expect(await countOf(REPO_1)).toBe(0);
    expect(await namesOf(OTHER_REPO)).toEqual(['b0']);
  });

  it('branch names are case-sensitive on PostgreSQL (main and Main coexist; on MySQL they collide)', async () => {
    await db.dataSource.transaction((manager) =>
      upsertBranches(manager, GithubBranch, [
        { repositoryId: REPO_C, name: 'main', isProtected: true },
        { repositoryId: REPO_C, name: 'Main', isProtected: false },
      ]),
    );

    const n = await countOf(REPO_C);
    if (db.dialect === 'postgres') {
      // varchar unique index: `main` and `Main` are two distinct rows.
      expect(n).toBe(2);
      // Sorted here: the database's ORDER BY follows its collation, which
      // puts `main` before or after `Main` depending on the server's locale.
      expect((await namesOf(REPO_C)).sort()).toEqual(['Main', 'main']);
    } else {
      // utf8mb4_0900_ai_ci: the second row updates the first in place.
      expect(n).toBe(1);
      const { rows } = await run(
        db.dataSource,
        sql`SELECT ${ident('isProtected')} FROM ${ident('github_branches')} WHERE ${ident('repositoryId')} = ${REPO_C}`,
      );
      expect(Number(rows[0].isProtected)).toBe(0);
    }
  });
});
