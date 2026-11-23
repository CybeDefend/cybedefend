import { Brackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { ilike } from '@cybedefend/db-dialect';

export interface MembersPageRequest {
  page: number;
  pageSize: number;
  searchQuery: string;
}

/**
 * `%query%` for a LIKE, with the query's own `%`, `_` and `\` taken literally
 * (the default LIKE / ILIKE escape character is the backslash on MySQL and
 * PostgreSQL).
 */
export function likeContains(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * One page of the members of an organization or a team, and their total, in
 * two SELECTs, never the whole membership with every user filtered and
 * paginated in JS.
 *
 * `query` reads the memberships (alias `membership`) of ONE organization or
 * team, its user LEFT JOINed and selected as `user`. The COUNT keeps every
 * membership the filter keeps: without a search, every membership of the
 * organization or team, which is what CountMembersInOrganization counts.
 *
 * - The search is a LIKE on the user's first name, last name and e-mail
 *   (db-dialect's `ilike`: LIKE on MySQL, ILIKE on PostgreSQL). On MySQL it
 *   follows the column collation (utf8mb4_0900_ai_ci): case-insensitive like
 *   the previous `toLowerCase().includes()`, and accent-insensitive too; on
 *   PostgreSQL case-insensitive only. No LOWER()/UPPER() (what TypeORM's
 *   ILike emits under MySQL), which would hide the column from the optimizer.
 * - The order is explicit: user id, then membership id, the order of
 *   IDX_uom_org_user / IDX_tm_team_user, so MySQL reads the page in index
 *   order. The previous read had no ORDER BY: its order was the plan's.
 * - A page or a page size below 1 reads no member (the previous slice of the
 *   whole list did not either, and a negative OFFSET is an SQL error).
 */
export async function readMembersPage<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  { page, pageSize, searchQuery }: MembersPageRequest,
): Promise<[T[], number]> {
  if (searchQuery) {
    query.andWhere(
      new Brackets((match) => {
        match
          .where(ilike('user.firstName', ':pattern').text)
          .orWhere(ilike('user.lastName', ':pattern').text)
          .orWhere(ilike('user.email', ':pattern').text);
      }),
      { pattern: likeContains(searchQuery) },
    );
  }
  query.orderBy('membership.userId', 'ASC').addOrderBy('membership.id', 'ASC');
  if (page < 1 || pageSize < 1) return [[], await query.getCount()];
  return query
    .offset((page - 1) * pageSize)
    .limit(pageSize)
    .getManyAndCount();
}

/** The page count of `total` members by pages of `pageSize`. */
export function membersPageCount(total: number, pageSize: number): number {
  // The previous Math.ceil(total / 0) was Infinity, or NaN, both 0 on the wire.
  return pageSize >= 1 ? Math.ceil(total / pageSize) : 0;
}
