import {
  auditTeamOrgMembership,
  type AuditDatabase,
  type AuditPermify,
} from './team-org-membership-audit';

/**
 * The team/organisation membership data audit (a one-off CLI script runs
 * it), run before the schema release that adds `org_member`. From then on every
 * team and project
 * permission needs both the team's `team#organization` tuple and the caller's
 * organisation role tuple: a legacy member without the latter silently loses
 * every project.
 *
 * The database is the source of truth. It lists:
 *  (a) a team without its `team#organization` tuple;
 *  (b) an organisation member (database) without any organisation role
 *      tuple; one holding another role than the database's is reported, never
 *      changed;
 *  (c) a team member who is no organisation member in the database: report
 *      only, never granted.
 * `--apply` writes the missing tuples of (a) and (b), from the database, and
 * nothing for anything else. Dry run by default, idempotent, one line per
 * finding then a SUMMARY, ids only, exit 1 on any error.
 */
describe('auditTeamOrgMembership', () => {
  type Team = { id: string; organizationId: string };
  type Member = { organizationId: string; userId: string; role: string };
  type TeamMember = { teamId: string; organizationId: string; userId: string };

  const tupleKey = (
    entityType: string,
    entityId: string,
    relation: string,
    subjectType: string,
    subjectId: string,
  ) => `${entityType}:${entityId}#${relation}@${subjectType}:${subjectId}`;

  const build = ({
    teams = [] as Team[],
    members = [] as Member[],
    teamMembers = [] as TeamMember[],
    tuples = [] as string[],
    failReadFor = [] as string[],
    failWriteFor = [] as string[],
    unconfirmedWriteFor = [] as string[],
    failListRead = false,
  } = {}) => {
    const store = new Set(tuples);
    const writes: string[] = [];
    const reads: string[] = [];
    const db: AuditDatabase = {
      query: jest.fn(async (sql: string): Promise<unknown[]> => {
        if (failListRead) throw new Error('ER_ACCESS_DENIED for ops@acme.test');
        if (/FROM `teams_members`/.test(sql)) return teamMembers;
        if (/FROM `users_organizations_members`/.test(sql)) return members;
        if (/FROM `team`/.test(sql)) return teams;
        throw new Error(`unexpected query: ${sql}`);
      }) as AuditDatabase['query'],
    };
    const permify: AuditPermify = {
      readRelationships: jest.fn(async ({ entity, subject }) => {
        reads.push(`${entity.type}:${entity.id}@${subject.type}:${subject.id}`);
        if (
          failReadFor.includes(entity.id) ||
          failReadFor.includes(subject.id)
        ) {
          throw new Error('14 UNAVAILABLE: connect failed for jane@acme.test');
        }
        const prefix = `${entity.type}:${entity.id}#`;
        const suffix = `@${subject.type}:${subject.id}`;
        return [...store]
          .filter((t) => t.startsWith(prefix) && t.endsWith(suffix))
          .map((t) => t.slice(prefix.length, t.length - suffix.length));
      }),
      writePermission: jest.fn(
        async (resourceId, subjectId, subjectType, resourceType, relation) => {
          if (failWriteFor.includes(resourceId))
            throw new Error('write failed');
          const key = tupleKey(
            resourceType,
            resourceId,
            relation,
            subjectType,
            subjectId,
          );
          writes.push(key);
          if (unconfirmedWriteFor.includes(resourceId)) return false;
          store.add(key);
          return true;
        },
      ),
    };
    return { db, permify, store, writes, reads };
  };

  const run = (t: ReturnType<typeof build>, apply = false) =>
    auditTeamOrgMembership({ db: t.db, permify: t.permify, apply });

  /** o1 with its team t1; t2 has lost its organisation tuple. */
  const legacy = () =>
    build({
      teams: [
        { id: 't1', organizationId: 'o1' },
        { id: 't2', organizationId: 'o1' },
      ],
      members: [
        { organizationId: 'o1', userId: 'u-creator', role: 'creator' },
        // (b): no organisation role tuple at all.
        { organizationId: 'o1', userId: 'u-dev', role: 'member' },
        // Another role in Permify than in the database: reported only.
        { organizationId: 'o1', userId: 'u-drift', role: 'member' },
      ],
      teamMembers: [
        { teamId: 't1', organizationId: 'o1', userId: 'u-dev' },
        // (c): in a team, but no organisation member in the database.
        { teamId: 't2', organizationId: 'o1', userId: 'u-gone' },
      ],
      tuples: [
        tupleKey('team', 't1', 'organization', 'organization', 'o1'),
        tupleKey('organization', 'o1', 'creator', 'user', 'u-creator'),
        tupleKey('organization', 'o1', 'administrator', 'user', 'u-drift'),
        // A product tuple is no organisation role.
        tupleKey('organization', 'o1', 'vibedefend_user', 'user', 'u-dev'),
        tupleKey('team', 't2', 'developer', 'user', 'u-gone'),
      ],
    });

  it('dry run: lists each finding, ids only, and writes nothing', async () => {
    const t = legacy();

    const report = await run(t);

    expect(report.lines).toEqual([
      'TEAM_ORGANIZATION_MISSING team=t2 organization=o1',
      'MEMBER_ROLE_MISSING organization=o1 user=u-dev role=member',
      'MEMBER_ROLE_DIFFERS organization=o1 user=u-drift role=member permify=administrator',
      'TEAM_MEMBER_NOT_IN_ORGANIZATION team=t2 organization=o1 user=u-gone',
      'SUMMARY dry-run: 2 teams, 3 organisation members, 2 team members; 1 TEAM_ORGANIZATION_MISSING, 1 MEMBER_ROLE_MISSING, 1 MEMBER_ROLE_DIFFERS, 1 TEAM_MEMBER_NOT_IN_ORGANIZATION, 0 ERROR',
    ]);
    expect(t.permify.writePermission).not.toHaveBeenCalled();
    expect(report.exitCode).toBe(0);
  });

  it('--apply writes the missing tuples of (a) and (b) from the database, nothing else', async () => {
    const t = legacy();

    const report = await run(t, true);

    expect(t.writes).toEqual([
      tupleKey('team', 't2', 'organization', 'organization', 'o1'),
      tupleKey('organization', 'o1', 'member', 'user', 'u-dev'),
    ]);
    expect(report.lines).toEqual([
      'TEAM_ORGANIZATION_WRITTEN team=t2 organization=o1',
      'MEMBER_ROLE_WRITTEN organization=o1 user=u-dev role=member',
      'MEMBER_ROLE_DIFFERS organization=o1 user=u-drift role=member permify=administrator',
      'TEAM_MEMBER_NOT_IN_ORGANIZATION team=t2 organization=o1 user=u-gone',
      'SUMMARY apply: 2 teams, 3 organisation members, 2 team members; 1 TEAM_ORGANIZATION_WRITTEN, 1 MEMBER_ROLE_WRITTEN, 1 MEMBER_ROLE_DIFFERS, 1 TEAM_MEMBER_NOT_IN_ORGANIZATION, 0 ERROR',
    ]);
    // (c) is never granted: no organisation tuple for u-gone.
    expect(
      [...t.store].some(
        (k) => k.startsWith('organization:o1#') && k.endsWith('@user:u-gone'),
      ),
    ).toBe(false);
    // The differing role is left as it is.
    expect(
      t.store.has(tupleKey('organization', 'o1', 'member', 'user', 'u-drift')),
    ).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it('is idempotent: a second run finds no (a) and no (b), and writes nothing', async () => {
    const t = legacy();
    await run(t, true);
    (t.permify.writePermission as jest.Mock).mockClear();

    const again = await run(t, true);

    expect(t.permify.writePermission).not.toHaveBeenCalled();
    expect(again.counts.teamOrganization).toBe(0);
    expect(again.counts.memberRole).toBe(0);
    expect(again.exitCode).toBe(0);
  });

  it('reads Permify once per team and once per organisation member, in that order', async () => {
    const t = legacy();

    await run(t);

    expect(t.reads).toEqual([
      'team:t1@organization:o1',
      'team:t2@organization:o1',
      'organization:o1@user:u-creator',
      'organization:o1@user:u-dev',
      'organization:o1@user:u-drift',
    ]);
  });

  it('a clean organisation prints only its SUMMARY', async () => {
    const t = build({
      teams: [{ id: 't1', organizationId: 'o1' }],
      members: [{ organizationId: 'o1', userId: 'u1', role: 'administrator' }],
      teamMembers: [{ teamId: 't1', organizationId: 'o1', userId: 'u1' }],
      tuples: [
        tupleKey('team', 't1', 'organization', 'organization', 'o1'),
        tupleKey('organization', 'o1', 'administrator', 'user', 'u1'),
      ],
    });

    const report = await run(t, true);

    expect(report.lines).toEqual([
      'SUMMARY apply: 1 team, 1 organisation member, 1 team member; 0 TEAM_ORGANIZATION_WRITTEN, 0 MEMBER_ROLE_WRITTEN, 0 MEMBER_ROLE_DIFFERS, 0 TEAM_MEMBER_NOT_IN_ORGANIZATION, 0 ERROR',
    ]);
  });

  it('a role the schema does not know is an ERROR, and is never written', async () => {
    const t = build({
      members: [{ organizationId: 'o1', userId: 'u1', role: 'owner' }],
    });

    const report = await run(t, true);

    expect(t.permify.writePermission).not.toHaveBeenCalled();
    expect(report.lines[0]).toBe(
      'ERROR member organization=o1 user=u1 has a role the schema does not know, nothing written',
    );
    expect(report.exitCode).toBe(1);
  });

  it('two different roles for one member in the database: an ERROR, nothing written', async () => {
    const t = build({
      members: [
        { organizationId: 'o1', userId: 'u1', role: 'member' },
        { organizationId: 'o1', userId: 'u1', role: 'manager' },
      ],
    });

    const report = await run(t, true);

    expect(t.permify.writePermission).not.toHaveBeenCalled();
    expect(report.lines[0]).toBe(
      'ERROR member organization=o1 user=u1 has several roles in the database, nothing written',
    );
    expect(report.exitCode).toBe(1);
  });

  it('the same member twice with the same role is read once', async () => {
    const t = build({
      members: [
        { organizationId: 'o1', userId: 'u1', role: 'member' },
        { organizationId: 'o1', userId: 'u1', role: 'member' },
      ],
      tuples: [tupleKey('organization', 'o1', 'member', 'user', 'u1')],
    });

    const report = await run(t);

    expect(t.reads).toEqual(['organization:o1@user:u1']);
    expect(report.exitCode).toBe(0);
  });

  it('a Permify read failure is an ERROR, never a write; the run goes on and exits 1, e-mails redacted', async () => {
    const t = build({
      teams: [
        { id: 't1', organizationId: 'o1' },
        { id: 't2', organizationId: 'o1' },
      ],
      failReadFor: ['t1'],
    });

    const report = await run(t, true);

    expect(report.lines[0]).toBe(
      'ERROR team=t1 organization=o1 not read: 14 UNAVAILABLE: connect failed for <redacted>',
    );
    expect(report.lines[1]).toBe(
      'TEAM_ORGANIZATION_WRITTEN team=t2 organization=o1',
    );
    expect(t.writes).toEqual([
      tupleKey('team', 't2', 'organization', 'organization', 'o1'),
    ]);
    expect(report.exitCode).toBe(1);
    expect(report.lines.join('\n')).not.toContain('@');
  });

  it('a write that fails or is not confirmed is an ERROR, and exits 1', async () => {
    const t = build({
      teams: [{ id: 't1', organizationId: 'o1' }],
      members: [{ organizationId: 'o2', userId: 'u1', role: 'member' }],
      failWriteFor: ['t1'],
      unconfirmedWriteFor: ['o2'],
    });

    const report = await run(t, true);

    expect(report.lines.slice(0, 2)).toEqual([
      'ERROR team=t1 organization=o1 tuple not written, re-run the script: write failed',
      'ERROR member organization=o2 user=u1 tuple not confirmed, re-run the script',
    ]);
    expect(report.counts.error).toBe(2);
    expect(report.exitCode).toBe(1);
  });

  it('a failed database read rejects before any Permify call', async () => {
    const t = build({ failListRead: true });

    await expect(run(t)).rejects.toThrow('ER_ACCESS_DENIED');
    expect(t.permify.readRelationships).not.toHaveBeenCalled();
  });

  it('paces every Permify call when asked', async () => {
    const t = legacy();
    const pace = jest.fn(async () => undefined);

    await auditTeamOrgMembership({
      db: t.db,
      permify: t.permify,
      apply: true,
      pace,
    });

    // 2 team reads + 3 member reads + 2 writes.
    expect(pace).toHaveBeenCalledTimes(7);
  });

  it('hands every line to `log` as it goes', async () => {
    const t = legacy();
    const log = jest.fn();

    const report = await auditTeamOrgMembership({
      db: t.db,
      permify: t.permify,
      apply: false,
      log,
    });

    expect(log.mock.calls.map(([line]) => line)).toEqual(report.lines);
  });
});
