import { ident } from '@cybedefend/db-dialect';
import { redactEmails } from '../../core/logging/redact-emails';

/**
 * The team/organisation membership data audit, run by a one-off CLI script
 * before the schema release that adds `org_member`, on every environment.
 *
 * From that schema on, every team and project permission needs both the
 * team's `team#organization` tuple and the caller's organisation role tuple
 * (`organization.read`). A legacy member with a team tuple but no
 * organisation role tuple (an old SSO or invitation path, a past partial
 * failure) would silently lose every project. global-management's database
 * is the source of truth; this lists, and with `apply` repairs, where Permify
 * disagrees with it:
 *   TEAM_ORGANIZATION_MISSING / _WRITTEN   (a) a team of the database without
 *       its `team#organization` tuple; `apply` writes it;
 *   MEMBER_ROLE_MISSING / _WRITTEN         (b) an organisation member of the
 *       database without any organisation role tuple; `apply` writes the
 *       database's role;
 *   MEMBER_ROLE_DIFFERS                    a member whose Permify role is not
 *       the database's: reported, never changed (which one is right is a
 *       human call, and writing a second role would grant both);
 *   TEAM_MEMBER_NOT_IN_ORGANIZATION        (c) a team member who is no member
 *       of the team's organisation in the database: reported, never granted
 *       (the new schema refuses them every team and project permission);
 *   ERROR                                  a read or a write failed, or the
 *       database holds a role the schema does not know, or several roles for
 *       one member: nothing is written for it; the run goes on and exits 1.
 * Read-only by default, idempotent (a second run lists no (a) and no (b)),
 * one line per finding then a SUMMARY. Lines carry ids, never an e-mail
 * (driver messages are redacted).
 */

/** The MySQL connection the audit reads: rows for a SELECT. */
export interface AuditDatabase {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** What the audit asks Permify (PermifyService satisfies it). */
export interface AuditPermify {
  readRelationships(filter: {
    entity: { type: string; id: string };
    subject: { type: string; id: string };
  }): Promise<string[]>;
  writePermission(
    resourceId: string,
    subjectId: string,
    subjectType: string,
    resourceType: string,
    relation: string,
  ): Promise<boolean>;
}

export interface AuditReport {
  lines: string[];
  counts: {
    /** (a) missing, or written with `apply`. */
    teamOrganization: number;
    /** (b) missing, or written with `apply`. */
    memberRole: number;
    roleDiffers: number;
    /** (c) */
    teamMemberOutside: number;
    error: number;
  };
  exitCode: 0 | 1;
}

/** The organisation roles of the schema (`entity organization`). */
const ORGANIZATION_ROLES: ReadonlySet<string> = new Set([
  'creator',
  'administrator',
  'manager',
  'billing_manager',
  'member',
]);

// Identifiers through ident(): backticks on MySQL (the cloud, which runs this
// audit), double quotes on PostgreSQL.
const q = (name: string) => ident(name).text;

const TEAMS_SQL = `SELECT ${q('team.id')} AS ${q('id')}, ${q('team.organizationId')} AS ${q('organizationId')} FROM ${q('team')} INNER JOIN ${q('organization')} ON ${q('organization.id')} = ${q('team.organizationId')} ORDER BY ${q('team.organizationId')}, ${q('team.id')}`;

const MEMBERS_SQL = `SELECT ${q('organizationId')}, ${q('userId')}, ${q('role')} FROM ${q('users_organizations_members')} ORDER BY ${q('organizationId')}, ${q('userId')}`;

const TEAM_MEMBERS_SQL = `SELECT ${q('teams_members.teamId')} AS ${q('teamId')}, ${q('team.organizationId')} AS ${q('organizationId')}, ${q('teams_members.userId')} AS ${q('userId')} FROM ${q('teams_members')} INNER JOIN ${q('team')} ON ${q('team.id')} = ${q('teams_members.teamId')} ORDER BY ${q('team.organizationId')}, ${q('teams_members.teamId')}, ${q('teams_members.userId')}`;

interface TeamRow {
  id: string;
  organizationId: string;
}
interface MemberRow {
  organizationId: string;
  userId: string;
  role: string;
}
interface TeamMemberRow {
  teamId: string;
  organizationId: string;
  userId: string;
}

const message = (e: unknown): string =>
  redactEmails(String((e as Error | null)?.message ?? e));

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export async function auditTeamOrgMembership(opts: {
  db: AuditDatabase;
  permify: AuditPermify;
  apply: boolean;
  log?: (line: string) => void;
  /** Awaited before every Permify call (the CLI paces them). */
  pace?: () => Promise<void>;
}): Promise<AuditReport> {
  const { db, permify, apply } = opts;
  const pace = opts.pace ?? (async () => undefined);
  const lines: string[] = [];
  const counts = {
    teamOrganization: 0,
    memberRole: 0,
    roleDiffers: 0,
    teamMemberOutside: 0,
    error: 0,
  };
  const emit = (line: string) => {
    lines.push(line);
    opts.log?.(line);
  };
  const error = (line: string) => {
    counts.error++;
    emit(line);
  };

  // Every read of the database first: a failure throws before any Permify
  // call, and nothing is written from a partial picture.
  const teams = await db.query<TeamRow>(TEAMS_SQL);
  const memberRows = await db.query<MemberRow>(MEMBERS_SQL);
  const teamMembers = await db.query<TeamMemberRow>(TEAM_MEMBERS_SQL);

  /**
   * Writes one tuple. Answers the ERROR line's tail when Permify did not
   * confirm it (a failure may still have been applied: a re-run checks).
   */
  const write = async (
    resourceType: string,
    resourceId: string,
    relation: string,
    subjectType: string,
    subjectId: string,
  ): Promise<string | null> => {
    try {
      await pace();
      const confirmed = await permify.writePermission(
        resourceId,
        subjectId,
        subjectType,
        resourceType,
        relation,
      );
      return confirmed ? null : 'tuple not confirmed, re-run the script';
    } catch (e) {
      return `tuple not written, re-run the script: ${message(e)}`;
    }
  };

  // (a) Every team's `team#organization` tuple.
  for (const team of teams) {
    const where = `team=${team.id} organization=${team.organizationId}`;
    let relations: string[];
    try {
      await pace();
      relations = await permify.readRelationships({
        entity: { type: 'team', id: team.id },
        subject: { type: 'organization', id: team.organizationId },
      });
    } catch (e) {
      error(`ERROR ${where} not read: ${message(e)}`);
      continue;
    }
    if (relations.includes('organization')) continue;
    if (!apply) {
      counts.teamOrganization++;
      emit(`TEAM_ORGANIZATION_MISSING ${where}`);
      continue;
    }
    const failure = await write(
      'team',
      team.id,
      'organization',
      'organization',
      team.organizationId,
    );
    if (failure) {
      error(`ERROR ${where} ${failure}`);
      continue;
    }
    counts.teamOrganization++;
    emit(`TEAM_ORGANIZATION_WRITTEN ${where}`);
  }

  // (b) Every organisation member's role tuple. One member, one role: a
  // duplicate row with the same role is read once, two roles are an error.
  const members = new Map<string, MemberRow>();
  const conflicting = new Set<string>();
  for (const row of memberRows) {
    const key = `${row.organizationId}/${row.userId}`;
    const known = members.get(key);
    if (!known) members.set(key, row);
    else if (known.role !== row.role) conflicting.add(key);
  }
  for (const [key, member] of members) {
    const where = `organization=${member.organizationId} user=${member.userId}`;
    if (conflicting.has(key)) {
      error(
        `ERROR member ${where} has several roles in the database, nothing written`,
      );
      continue;
    }
    if (!ORGANIZATION_ROLES.has(member.role)) {
      error(
        `ERROR member ${where} has a role the schema does not know, nothing written`,
      );
      continue;
    }
    let held: string[];
    try {
      await pace();
      held = (
        await permify.readRelationships({
          entity: { type: 'organization', id: member.organizationId },
          subject: { type: 'user', id: member.userId },
        })
      ).filter((relation) => ORGANIZATION_ROLES.has(relation));
    } catch (e) {
      error(`ERROR member ${where} not read: ${message(e)}`);
      continue;
    }
    if (held.includes(member.role)) continue;
    if (held.length > 0) {
      counts.roleDiffers++;
      emit(
        `MEMBER_ROLE_DIFFERS ${where} role=${member.role} permify=${[...held].sort().join(',')}`,
      );
      continue;
    }
    if (!apply) {
      counts.memberRole++;
      emit(`MEMBER_ROLE_MISSING ${where} role=${member.role}`);
      continue;
    }
    const failure = await write(
      'organization',
      member.organizationId,
      member.role,
      'user',
      member.userId,
    );
    if (failure) {
      error(`ERROR member ${where} ${failure}`);
      continue;
    }
    counts.memberRole++;
    emit(`MEMBER_ROLE_WRITTEN ${where} role=${member.role}`);
  }

  // (c) Team members outside their team's organisation, from the database
  // alone. Never granted: who belongs to an organisation is not this
  // script's call.
  for (const row of teamMembers) {
    if (members.has(`${row.organizationId}/${row.userId}`)) continue;
    counts.teamMemberOutside++;
    emit(
      `TEAM_MEMBER_NOT_IN_ORGANIZATION team=${row.teamId} organization=${row.organizationId} user=${row.userId}`,
    );
  }

  const missing = apply ? 'WRITTEN' : 'MISSING';
  emit(
    `SUMMARY ${apply ? 'apply' : 'dry-run'}: ` +
      `${plural(teams.length, 'team', 'teams')}, ` +
      `${plural(members.size, 'organisation member', 'organisation members')}, ` +
      `${plural(teamMembers.length, 'team member', 'team members')}; ` +
      `${counts.teamOrganization} TEAM_ORGANIZATION_${missing}, ` +
      `${counts.memberRole} MEMBER_ROLE_${missing}, ` +
      `${counts.roleDiffers} MEMBER_ROLE_DIFFERS, ` +
      `${counts.teamMemberOutside} TEAM_MEMBER_NOT_IN_ORGANIZATION, ` +
      `${counts.error} ERROR`,
  );
  return { lines, counts, exitCode: counts.error > 0 ? 1 : 0 };
}
