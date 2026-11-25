import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';
import { dialectApi, parseDialect, run } from '@cybedefend/db-dialect';

/**
 * The roles of each table from the widest to the narrowest, as the service
 * ranks them (copied here: a migration never follows later code changes).
 * A role outside the list ranks last.
 */
const ORGANIZATION_ROLE_RANK = [
  'creator',
  'administrator',
  'manager',
  'billing_manager',
  'member',
];
const TEAM_ROLE_RANK = [
  'team_manager',
  'analyst_developer',
  'developer',
  'read_only',
];

/** One membership table, the column that scopes it, its indexes. */
interface MembershipTable {
  table: string;
  scope: string;
  previousIndex: string;
  uniqueIndex: string;
  roleRank: readonly string[];
}

const MEMBERSHIP_TABLES: readonly MembershipTable[] = [
  {
    table: 'users_organizations_members',
    scope: 'organizationId',
    previousIndex: 'IDX_uom_org_user',
    uniqueIndex: 'UQ_uom_org_user',
    roleRank: ORGANIZATION_ROLE_RANK,
  },
  {
    table: 'teams_members',
    scope: 'teamId',
    previousIndex: 'IDX_tm_team_user',
    uniqueIndex: 'UQ_tm_team_user',
    roleRank: TEAM_ROLE_RANK,
  },
];

/** Ids deleted per statement. */
const DELETE_BATCH = 500;

/** A boolean column reads 1/0 on MySQL and true/false on PostgreSQL. */
const normalised = (value: unknown) =>
  typeof value === 'boolean' ? Number(value) : value;

const rankOf = (ranks: readonly string[], role: string) => {
  const at = ranks.indexOf(role);
  return at === -1 ? ranks.length : at;
};

/**
 * One table made unique, every step safe to run again: on MySQL each DDL
 * statement commits by itself, so a run stopped half-way leaves part of the
 * work done, and the next start must finish it instead of failing on it.
 *
 * 1. Each (scope, user) pair holding several rows keeps one: the row of the
 *    widest role (an organisation creator's row always), the highest id
 *    between rows of the same role. The others are deleted.
 *    Pairs whose rows differ in any column but their id (the role, the
 *    per-member product flags of an organisation membership) are logged with
 *    their ids and roles, so that the permission relations of those
 *    members can be checked by hand. No address is logged.
 * 2. The unique index is created if it does not exist yet. The rows are
 *    deduplicated again right before, in case a duplicate was written since.
 * 3. The former non-unique index is dropped if it still exists (after the
 *    unique one: on MySQL the foreign key on the scope column may rely on it).
 */
async function makeMembershipRowsUnique(
  queryRunner: QueryRunner,
  t: MembershipTable,
  log: (message: string) => void,
): Promise<void> {
  const existing = await queryRunner.getTable(t.table);
  if (!existing?.indices.some((index) => index.name === t.uniqueIndex)) {
    await removeDuplicates(queryRunner, t, log);
    await queryRunner.createIndex(
      t.table,
      new TableIndex({
        name: t.uniqueIndex,
        columnNames: [t.scope, 'userId'],
        isUnique: true,
      }),
    );
  }
  const now = await queryRunner.getTable(t.table);
  if (now?.indices.some((index) => index.name === t.previousIndex)) {
    await queryRunner.dropIndex(t.table, t.previousIndex);
  }
}

async function removeDuplicates(
  queryRunner: QueryRunner,
  t: MembershipTable,
  log: (message: string) => void,
): Promise<void> {
  const { sql, ident, inList } = dialectApi(
    parseDialect(queryRunner.connection.options.type),
  );
  const pairs = await run(
    queryRunner,
    sql`SELECT ${ident(t.scope)} AS ${ident('scopeId')}, ${ident('userId')} AS ${ident('userId')} FROM ${ident(t.table)} GROUP BY ${ident(t.scope)}, ${ident('userId')} HAVING COUNT(*) > 1`,
  );

  const doomed: string[] = [];
  for (const pair of pairs.rows) {
    const scopeId = String(pair.scopeId);
    const userId = String(pair.userId);
    const { rows } = await run(
      queryRunner,
      sql`SELECT * FROM ${ident(t.table)} WHERE ${ident(t.scope)} = ${scopeId} AND ${ident('userId')} = ${userId}`,
    );
    const ordered = rows
      .map((r) => ({
        id: String(r.id),
        role: String(r.role),
        // Every other column (the product flags), the id left out.
        rest: JSON.stringify(
          Object.keys(r)
            .filter((key) => key !== 'id')
            .sort()
            .map((key) => [key, normalised(r[key])]),
        ),
      }))
      .sort((a, b) => {
        const byRank = rankOf(t.roleRank, a.role) - rankOf(t.roleRank, b.role);
        if (byRank !== 0) return byRank;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });
    const differs =
      new Set(ordered.map((r) => r.role)).size > 1 ||
      new Set(ordered.map((r) => r.rest)).size > 1;
    if (differs) {
      log(
        `duplicate rows differ in ${t.table}: ${t.scope}=${scopeId} userId=${userId} kept role ${ordered[0].role}, deleted ${ordered
          .slice(1)
          .map((r) => r.role)
          .join(', ')}; check the permission relations of this member`,
      );
    }
    doomed.push(...ordered.slice(1).map((r) => r.id));
  }

  for (let i = 0; i < doomed.length; i += DELETE_BATCH) {
    await run(
      queryRunner,
      sql`DELETE FROM ${ident(t.table)} WHERE ${ident('id')} IN ${inList(doomed.slice(i, i + DELETE_BATCH))}`,
    );
  }
  log(
    `${doomed.length} duplicate row(s) removed from ${t.table} (${pairs.rows.length} pair(s))`,
  );
}

/**
 * One membership row per (organisation, user) and per (team, user).
 *
 * Two requests that added the same member at the same moment could each
 * insert a row: the second row then kept the member counted, listed, or able
 * to act after a removal deleted only one of them. The service now
 * serialises those writes; this migration makes a second row impossible
 * (see makeMembershipRowsUnique for each step).
 *
 * On a table without duplicates it reads one grouped SELECT and deletes
 * nothing. Neither step rewrites the table: MySQL builds a secondary index
 * in place, with reads and writes allowed; PostgreSQL blocks writes to that
 * table (not reads) while it builds the index, a matter of milliseconds for
 * tables of one row per membership.
 *
 * If a duplicate is written by an older replica between the deduplication
 * and the index creation, the index creation fails and so does the start.
 * The next start runs the migration again and, every step being skipped
 * once done, finishes it.
 *
 * Portable schema API, plus raw SQL only through the dialect's `sql` tag.
 */
export class UniqueMembershipRows1786483000000 implements MigrationInterface {
  name = 'UniqueMembershipRows1786483000000';

  /** The two tables and one table's steps, for the spec of a partial run. */
  static readonly tables = MEMBERSHIP_TABLES;
  static readonly makeTableUnique = makeMembershipRowsUnique;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const log = (message: string) =>
      queryRunner.connection.logger.log('info', `${this.name}: ${message}`);
    for (const t of MEMBERSHIP_TABLES) {
      await makeMembershipRowsUnique(queryRunner, t, log);
    }
  }

  /** The non-unique indexes come back; the deleted duplicates do not. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const t of MEMBERSHIP_TABLES) {
      const table = await queryRunner.getTable(t.table);
      if (!table?.indices.some((index) => index.name === t.previousIndex)) {
        await queryRunner.createIndex(
          t.table,
          new TableIndex({
            name: t.previousIndex,
            columnNames: [t.scope, 'userId'],
          }),
        );
      }
      const now = await queryRunner.getTable(t.table);
      if (now?.indices.some((index) => index.name === t.uniqueIndex)) {
        await queryRunner.dropIndex(t.table, t.uniqueIndex);
      }
    }
  }
}
