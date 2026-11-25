import { randomUUID } from 'node:crypto';
import { dialectApi, isUniqueViolation, run } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  insertRows,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { UniqueMembershipRows1786483000000 } from '../1786483000000-UniqueMembershipRows';

/**
 * LIVE spec of UniqueMembershipRows on a REAL MySQL or PostgreSQL: the
 * schema is built by every migration of the service, this one is rolled
 * back (non-unique indexes again), rows are written, and the migration runs
 * again on them.
 *
 * Skipped unless GM_LIVE=1; the engine is LIVE_DB_TYPE (mysql by default),
 * the URL GM_MYSQL_URL or GM_PG_URL.
 */
const LIVE = liveEnabled('GM');
const describeLive = LIVE ? describe : describe.skip;

describeLive('UniqueMembershipRows1786483000000 (real database)', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  const migration = new UniqueMembershipRows1786483000000();

  beforeAll(async () => {
    live = await createLiveDatabase({
      prefix: 'gm_unique_membership',
      envPrefix: 'GM',
    });
  });

  afterAll(async () => {
    await live?.drop();
  });

  /** The lines the migration logs through the data source's logger. */
  function captureLog() {
    const lines: string[] = [];
    const spy = jest
      .spyOn(live.dataSource.logger, 'log')
      .mockImplementation((_level, message) => {
        lines.push(String(message));
      });
    return { lines, restore: () => spy.mockRestore() };
  }

  async function onRunner<T>(
    fn: (runner: import('typeorm').QueryRunner) => Promise<T>,
  ): Promise<T> {
    const runner = live.dataSource.createQueryRunner();
    await runner.connect();
    try {
      return await fn(runner);
    } finally {
      await runner.release();
    }
  }

  async function seed() {
    const users = Array.from({ length: 3 }, () => randomUUID());
    await insertRows(
      live,
      'user',
      users.map((id) => ({
        id,
        email: `${id}@example.test`,
        firstName: 'F',
        lastName: 'L',
        picture: '',
      })),
    );
    const organizationId = randomUUID();
    await insertRows(live, 'organization', [
      {
        id: organizationId,
        name: 'Org',
        industry: '',
        country: '',
        creatorId: users[0],
      },
    ]);
    const teamId = randomUUID();
    await insertRows(live, 'team', [
      {
        id: teamId,
        name: 'Team',
        description: '',
        organizationId,
        creatorId: users[0],
      },
    ]);
    return { users, organizationId, teamId };
  }

  async function rowsOf(table: string, scope: string, scopeId: string) {
    const db = dialectApi(live.dialect);
    const { rows } = await run(
      live.dataSource,
      db.sql`SELECT ${db.ident('id')}, ${db.ident('userId')}, ${db.ident('role')} FROM ${db.ident(table)} WHERE ${db.ident(scope)} = ${scopeId} ORDER BY ${db.ident('id')}`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.userId),
      role: String(r.role),
    }));
  }

  async function indexNames(table: string): Promise<string[]> {
    return onRunner(async (runner) => {
      const t = await runner.getTable(table);
      return (t?.indices ?? []).map((i) => i.name).sort();
    });
  }

  it('creates both unique indexes on a table without duplicates, deleting nothing', async () => {
    const { users, organizationId, teamId } = await seed();
    await insertRows(live, 'users_organizations_members', [
      { id: randomUUID(), organizationId, userId: users[0], role: 'creator' },
      { id: randomUUID(), organizationId, userId: users[1], role: 'member' },
    ]);
    await insertRows(live, 'teams_members', [
      { id: randomUUID(), teamId, userId: users[0], role: 'team_manager' },
    ]);

    // Already applied by createLiveDatabase: the indexes are there.
    expect(await indexNames('users_organizations_members')).toContain(
      'UQ_uom_org_user',
    );
    expect(await indexNames('users_organizations_members')).not.toContain(
      'IDX_uom_org_user',
    );
    expect(await indexNames('teams_members')).toContain('UQ_tm_team_user');
    expect(await indexNames('teams_members')).not.toContain('IDX_tm_team_user');

    // Down then up again on rows without duplicates: nothing deleted.
    await onRunner((runner) => migration.down(runner));
    await onRunner((runner) => migration.up(runner));
    expect(
      await rowsOf(
        'users_organizations_members',
        'organizationId',
        organizationId,
      ),
    ).toHaveLength(2);
    expect(await rowsOf('teams_members', 'teamId', teamId)).toHaveLength(1);
  });

  it('keeps the row of the widest role per pair, logs pairs that differ, then refuses a second row', async () => {
    await onRunner((runner) => migration.down(runner));
    const { users, organizationId, teamId } = await seed();
    const ids = Array.from({ length: 9 }, () => randomUUID()).sort();
    await insertRows(live, 'users_organizations_members', [
      // the creator's row wins over a later id
      { id: ids[0], organizationId, userId: users[0], role: 'creator' },
      { id: ids[8], organizationId, userId: users[0], role: 'member' },
      // the widest role wins over a later id
      { id: ids[1], organizationId, userId: users[1], role: 'administrator' },
      { id: ids[7], organizationId, userId: users[1], role: 'member' },
      // a single row stays
      { id: ids[2], organizationId, userId: users[2], role: 'manager' },
    ]);
    await insertRows(live, 'teams_members', [
      { id: ids[3], teamId, userId: users[1], role: 'read_only' },
      { id: ids[4], teamId, userId: users[1], role: 'team_manager' },
      // same role: the highest id wins, and nothing differs to report
      { id: ids[5], teamId, userId: users[2], role: 'developer' },
      { id: ids[6], teamId, userId: users[2], role: 'developer' },
    ]);

    const logged = captureLog();
    await onRunner((runner) => migration.up(runner));

    expect(
      await rowsOf(
        'users_organizations_members',
        'organizationId',
        organizationId,
      ),
    ).toEqual(
      [
        { id: ids[0], userId: users[0], role: 'creator' },
        { id: ids[1], userId: users[1], role: 'administrator' },
        { id: ids[2], userId: users[2], role: 'manager' },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(await rowsOf('teams_members', 'teamId', teamId)).toEqual(
      [
        { id: ids[4], userId: users[1], role: 'team_manager' },
        { id: ids[6], userId: users[2], role: 'developer' },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );

    const differing = logged.lines.filter((l) => l.includes('differ'));
    expect(differing).toHaveLength(3);
    expect(differing.join('\n')).toContain(
      `organizationId=${organizationId} userId=${users[1]} kept role administrator, deleted member`,
    );
    expect(differing.join('\n')).toContain(
      `teamId=${teamId} userId=${users[1]} kept role team_manager, deleted read_only`,
    );
    expect(differing.join('\n')).not.toContain(users[2]);
    expect(logged.lines.join('\n')).not.toMatch(/@/);
    logged.restore();

    const second = insertRows(live, 'users_organizations_members', [
      { id: randomUUID(), organizationId, userId: users[1], role: 'member' },
    ]);
    expect(isUniqueViolation(await second.catch((e: unknown) => e))).toBe(true);
    const secondTeamRow = insertRows(live, 'teams_members', [
      { id: randomUUID(), teamId, userId: users[1], role: 'developer' },
    ]);
    expect(
      isUniqueViolation(await secondTeamRow.catch((e: unknown) => e)),
    ).toBe(true);
  });

  it('logs a pair whose rows differ only in their product flags', async () => {
    await onRunner((runner) => migration.down(runner));
    const { users, organizationId } = await seed();
    await insertRows(live, 'users_organizations_members', [
      {
        id: randomUUID(),
        organizationId,
        userId: users[1],
        role: 'member',
        appsec_access: true,
      },
      {
        id: randomUUID(),
        organizationId,
        userId: users[1],
        role: 'member',
        appsec_access: false,
      },
    ]);
    const logged = captureLog();
    await onRunner((runner) => migration.up(runner));
    logged.restore();
    expect(
      logged.lines.filter(
        (l) => l.includes('differ') && l.includes(`userId=${users[1]}`),
      ),
    ).toHaveLength(1);
  });

  it('runs twice in a row without failing', async () => {
    await onRunner((runner) => migration.up(runner));
    await onRunner((runner) => migration.up(runner));
    expect(await indexNames('users_organizations_members')).toContain(
      'UQ_uom_org_user',
    );
    expect(await indexNames('teams_members')).toContain('UQ_tm_team_user');
  });

  it('finishes a run stopped between the two tables, a duplicate written since included', async () => {
    await onRunner((runner) => migration.down(runner));
    const { users, organizationId, teamId } = await seed();
    await insertRows(live, 'teams_members', [
      { id: randomUUID(), teamId, userId: users[1], role: 'developer' },
      { id: randomUUID(), teamId, userId: users[1], role: 'developer' },
    ]);
    // The first table done, then the run stops (a failure on the second).
    await onRunner((runner) =>
      UniqueMembershipRows1786483000000.makeTableUnique(
        runner,
        UniqueMembershipRows1786483000000.tables[0],
        () => undefined,
      ),
    );
    expect(await indexNames('users_organizations_members')).toContain(
      'UQ_uom_org_user',
    );
    expect(await indexNames('teams_members')).not.toContain('UQ_tm_team_user');
    // An older replica writes one more duplicate before the next start.
    await insertRows(live, 'teams_members', [
      { id: randomUUID(), teamId, userId: users[1], role: 'read_only' },
    ]);

    await onRunner((runner) => migration.up(runner));

    expect(await indexNames('users_organizations_members')).toContain(
      'UQ_uom_org_user',
    );
    expect(await indexNames('users_organizations_members')).not.toContain(
      'IDX_uom_org_user',
    );
    expect(await indexNames('teams_members')).toContain('UQ_tm_team_user');
    expect(await indexNames('teams_members')).not.toContain('IDX_tm_team_user');
    expect(await rowsOf('teams_members', 'teamId', teamId)).toHaveLength(1);
    expect(
      await rowsOf(
        'users_organizations_members',
        'organizationId',
        organizationId,
      ),
    ).toHaveLength(0);
  });
});
