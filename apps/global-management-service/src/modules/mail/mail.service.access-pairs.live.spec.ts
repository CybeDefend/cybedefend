import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Project } from 'src/entities/project.entity';
import {
  createLiveDatabase,
  insertRows,
  liveEnabled,
} from 'src/core/db/live-database';
import { MailService } from './mail.service';

/**
 * LIVE spec, on a REAL MySQL or PostgreSQL: who receives a project's AppSec
 * report (`fetchProjectAccessPairs`, used by the consolidated weekly, monthly
 * and daily-critical e-mails).
 *
 * The recipients come from EXISTS subqueries written as raw SQL, whose aliases
 * TypeORM does not know: their camelCase columns and the output aliases of the
 * read must be quoted, or PostgreSQL folds them to lower case (42703, then rows
 * keyed `userid`), and the two boolean columns are compared with TRUE / FALSE,
 * since PostgreSQL has no `boolean = integer`.
 *
 * Skipped unless `GM_LIVE=1`; the engine is `LIVE_DB_TYPE` (mysql by default):
 *   GM_LIVE=1 LIVE_DB_TYPE=postgres DB_TYPE=postgres GM_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=mail.service.access-pairs.live --runInBand
 */
const describeLive = liveEnabled('GM') ? describe : describe.skip;

describeLive('AppSec report recipients on a real database', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let drop: () => Promise<void>;
  let svc: MailService;

  // Organization `off`: per-member products off. Organization `on`: on.
  const off = { org: randomUUID(), team: randomUUID(), project: randomUUID() };
  const on = { org: randomUUID(), team: randomUUID(), project: randomUUID() };
  const creator = randomUUID();
  const administrator = randomUUID();
  const teamMember = randomUUID();
  const memberWithAppsec = randomUUID();
  const memberWithoutAppsec = randomUUID();
  const outsider = randomUUID();

  beforeAll(async () => {
    let dialect: 'mysql' | 'postgres';
    ({ dataSource, drop, dialect } = await createLiveDatabase({
      prefix: 'gm_mail_access_pairs',
      envPrefix: 'GM',
    }));
    const insert = (table: string, rows: Record<string, unknown>[]) =>
      insertRows({ dataSource, dialect }, table, rows);

    await insert('organization', [
      { id: off.org, name: 'Off', industry: 'IT', country: 'FR' },
      { id: on.org, name: 'On', industry: 'IT', country: 'FR' },
    ]);
    await dataSource
      .createQueryBuilder()
      .update('organization')
      .set({ memberProducts: true })
      .where('id = :id', { id: on.org })
      .execute();
    await insert('team', [
      { id: off.team, name: 'Core', description: '', organizationId: off.org },
      { id: on.team, name: 'Core', description: '', organizationId: on.org },
    ]);
    await insert('project', [
      { id: off.project, name: 'Payments', teamId: off.team },
      { id: on.project, name: 'Billing', teamId: on.team },
    ]);
    const users = [
      creator,
      administrator,
      teamMember,
      memberWithAppsec,
      memberWithoutAppsec,
      outsider,
    ];
    await insert(
      'user',
      users.map((id, i) => ({
        id,
        email: `user-${id}@example.test`,
        firstName: `First${i}`,
        lastName: 'L',
        picture: '',
      })),
    );
    const membership = (
      organizationId: string,
      userId: string,
      role: string,
      appsecAccess = true,
    ) => ({
      id: randomUUID(),
      organizationId,
      userId,
      role,
      appsec_access: appsecAccess,
    });
    await insert('users_organizations_members', [
      membership(off.org, creator, 'creator'),
      membership(off.org, administrator, 'administrator'),
      membership(off.org, teamMember, 'member', false),
      membership(off.org, outsider, 'member'),
      membership(on.org, creator, 'creator', false),
      membership(on.org, memberWithAppsec, 'member', true),
      membership(on.org, memberWithoutAppsec, 'member', false),
    ]);
    await insert('teams_members', [
      {
        id: randomUUID(),
        teamId: off.team,
        userId: teamMember,
        role: 'member',
      },
      {
        id: randomUUID(),
        teamId: on.team,
        userId: memberWithAppsec,
        role: 'member',
      },
      {
        id: randomUUID(),
        teamId: on.team,
        userId: memberWithoutAppsec,
        role: 'member',
      },
    ]);

    svc = new MailService(
      {} as never, // secretsService
      { get: () => '' } as never, // configService
      {} as never, // organizationRepo
      dataSource.getRepository(Project) as never,
      { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    await drop?.();
  });

  const pairs = (projectIds: string[]) =>
    (
      svc as unknown as {
        fetchProjectAccessPairs: (ids: string[]) => Promise<
          Array<{
            userId: string;
            email: string;
            firstName: string;
            notification: boolean;
            projectId: string;
          }>
        >;
      }
    ).fetchProjectAccessPairs(projectIds);

  it('switch off: the creator, the administrators and the team members, each with their name', async () => {
    const rows = await pairs([off.project]);

    expect(rows.map((r) => r.userId).sort()).toEqual(
      [creator, administrator, teamMember].sort(),
    );
    for (const row of rows) {
      expect(row.projectId).toBe(off.project);
      expect(row.email).toBe(`user-${row.userId}@example.test`);
      expect(row.firstName).toMatch(/^First\d$/);
    }
  });

  it('switch on: the creator always, a team member only while holding AppSec', async () => {
    const rows = await pairs([on.project]);

    expect(rows.map((r) => r.userId).sort()).toEqual(
      [creator, memberWithAppsec].sort(),
    );
  });

  it('several projects at once, each pair named by its project', async () => {
    const rows = await pairs([off.project, on.project]);

    expect(rows).toHaveLength(5);
    expect(
      rows.filter((r) => r.projectId === on.project).map((r) => r.userId),
    ).not.toContain(memberWithoutAppsec);
  });
});
