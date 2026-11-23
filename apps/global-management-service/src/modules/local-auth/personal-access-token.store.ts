import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ident,
  isUniqueViolation,
  run,
  sql,
  type Sql,
} from '@cybedefend/db-dialect';
import { User } from 'src/entities/user.entity';
import { localAuthRefusal } from './local-auth-refusals';
import { newOpaqueToken, tokenHash } from './token-hash';

/** The bearer prefix of a personal access token. */
export const PAT_PREFIX = 'cdp_';
/** `cdp_` + 32 random bytes base64url (43 characters). */
export const PAT_PATTERN = /^cdp_[A-Za-z0-9_-]{43}$/;
/** At most 10 active tokens per user (today's MAX_PATS_PER_USER). */
export const MAX_ACTIVE_PATS_PER_USER = 10;
/** A token name is 1–100 characters after trimming. */
export const PAT_NAME_MAX_LENGTH = 100;
/** `last_used_at` is written at most once per 60 s. */
export const PAT_LAST_USED_WRITE_INTERVAL_MS = 60_000;

/** The stored metadata of one personal access token; the secret is never kept. */
export interface LocalPat {
  id: string;
  name: string;
  lastFour: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

const TABLE = ident('personal_access_token');
const c = ident;

/** The organisation's members, as a portable subquery (all identifiers quoted). */
function membersOf(organizationId: string): Sql {
  return sql`(SELECT ${c('uom.userId')} FROM ${ident('users_organizations_members')} ${c('uom')}
    WHERE ${c('uom.organizationId')} = ${organizationId})`;
}

interface PatRow {
  id: string;
  name: string;
  lastFour: string;
  createdAt: Date | string | number;
  lastUsedAt: Date | string | number | null;
  expiresAt: Date | string | number | null;
}

const dateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string | number | Date);

function toLocalPat(row: PatRow): LocalPat {
  return {
    id: row.id,
    name: row.name,
    lastFour: row.lastFour,
    createdAt: new Date(row.createdAt),
    lastUsedAt: dateOrNull(row.lastUsedAt),
    expiresAt: dateOrNull(row.expiresAt),
  };
}

/**
 * The personal access tokens (`cdp_…`) of the Community Edition's
 * LocalAuthModule, in `personal_access_token` (the common migration
 * 1786300000000-CreateLocalIdentityTables; only LocalAuthModule reads or
 * writes it). Only the SHA-256 hash and the last four characters of a token
 * are stored, never the secret. The name of an active token is unique per
 * user through the generated column `active_name` and UQ_pat_user_active_name,
 * so a revoked token frees its name (an expired one is marked revoked at
 * the next create of its user).
 *
 * All SQL goes through libs/db-dialect, so it runs on MySQL and PostgreSQL
 * alike; the `user` table is only ever touched through the query
 * builder, never named in raw text. `run`'s `affected` counts the rows
 * matched by an UPDATE on both engines.
 */
@Injectable()
export class PersonalAccessTokenStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Creates a token. Before any query: an empty or over-100-character
   * (trimmed) name → PAT_NAME_INVALID; an expiry not after `now` →
   * PAT_EXPIRY_INVALID. Then one transaction that locks the user row
   * (pessimistic_write), marks the user's expired tokens revoked (so they
   * hold neither a slot nor their name), refuses at 10 active tokens with
   * PAT_LIMIT_REACHED,
   * and inserts the row as its last statement: a unique violation on
   * UQ_pat_user_active_name rolls the transaction back and is mapped to
   * PAT_NAME_TAKEN after it (nothing runs after the INSERT, so no savepoint).
   */
  async create(
    userId: string,
    name: string,
    expiresAt: Date | null,
    now: Date,
  ): Promise<{ pat: LocalPat; token: string }> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > PAT_NAME_MAX_LENGTH) {
      throw localAuthRefusal('PAT_NAME_INVALID');
    }
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
      throw localAuthRefusal('PAT_EXPIRY_INVALID');
    }
    const token = PAT_PREFIX + newOpaqueToken();
    const id = randomUUID();
    const lastFour = token.slice(-4);
    try {
      await this.dataSource.transaction(async (manager) => {
        // Serialize concurrent creates of one user: the lock is a locking
        // read, so the count below sees the winners' committed rows on both
        // engines.
        await manager
          .getRepository(User)
          .createQueryBuilder('u')
          .setLock('pessimistic_write')
          .where('u.id = :userId', { userId })
          .getOne();
        // An expired token is neither listed nor usable, so it must not hold
        // a slot of the limit or its name: mark it revoked first.
        await run(
          manager,
          sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
            WHERE ${c('user_id')} = ${userId}
              AND ${c('revoked_at')} IS NULL
              AND ${c('expires_at')} IS NOT NULL
              AND ${c('expires_at')} <= ${now}`,
        );
        const { rows } = await run(
          manager,
          sql`SELECT COUNT(*) AS ${c('n')} FROM ${TABLE}
            WHERE ${c('user_id')} = ${userId}
              AND ${c('revoked_at')} IS NULL
              AND (${c('expires_at')} IS NULL OR ${c('expires_at')} > ${now})`,
        );
        if (Number(rows[0]?.n) >= MAX_ACTIVE_PATS_PER_USER) {
          throw localAuthRefusal('PAT_LIMIT_REACHED');
        }
        await run(
          manager,
          sql`INSERT INTO ${TABLE} (${c('id')}, ${c('user_id')}, ${c('name')}, ${c('token_hash')}, ${c('last_four')}, ${c('last_used_at')}, ${c('expires_at')}, ${c('revoked_at')}, ${c('created_at')})
            VALUES (${id}, ${userId}, ${trimmed}, ${tokenHash(token)}, ${lastFour}, ${null}, ${expiresAt}, ${null}, ${now})`,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw localAuthRefusal('PAT_NAME_TAKEN');
      throw e;
    }
    return {
      pat: {
        id,
        name: trimmed,
        lastFour,
        createdAt: now,
        lastUsedAt: null,
        expiresAt,
      },
      token,
    };
  }

  /** The active tokens of the user (not revoked, not expired), newest first. */
  async list(userId: string, now: Date): Promise<LocalPat[]> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('id')}, ${c('name')}, ${c('last_four')} AS ${c('lastFour')},
        ${c('created_at')} AS ${c('createdAt')}, ${c('last_used_at')} AS ${c('lastUsedAt')},
        ${c('expires_at')} AS ${c('expiresAt')}
        FROM ${TABLE}
        WHERE ${c('user_id')} = ${userId}
          AND ${c('revoked_at')} IS NULL
          AND (${c('expires_at')} IS NULL OR ${c('expires_at')} > ${now})
        ORDER BY ${c('created_at')} DESC, ${c('id')} DESC`,
    );
    return (rows as unknown as PatRow[]).map(toLocalPat);
  }

  /**
   * Revokes one token of the user. `affected` 0 (unknown id, another user's,
   * already revoked) → PAT_NOT_FOUND.
   */
  async revoke(userId: string, id: string, now: Date): Promise<void> {
    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('id')} = ${id} AND ${c('user_id')} = ${userId}
          AND ${c('revoked_at')} IS NULL`,
    );
    if (affected === 0) throw localAuthRefusal('PAT_NOT_FOUND');
  }

  /** Revokes the user's active token of that name; a miss → PAT_NOT_FOUND. */
  async revokeByName(userId: string, name: string, now: Date): Promise<void> {
    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('user_id')} = ${userId} AND ${c('name')} = ${name}
          AND ${c('revoked_at')} IS NULL`,
    );
    if (affected === 0) throw localAuthRefusal('PAT_NOT_FOUND');
  }

  /**
   * Renames the user's active token `currentName` to `newName`: one UPDATE
   * outside any wider transaction; a unique violation on
   * UQ_pat_user_active_name → PAT_NAME_TAKEN, a miss → PAT_NOT_FOUND.
   */
  async rename(
    userId: string,
    currentName: string,
    newName: string,
  ): Promise<LocalPat> {
    const trimmed = newName.trim();
    if (trimmed.length === 0 || trimmed.length > PAT_NAME_MAX_LENGTH) {
      throw localAuthRefusal('PAT_NAME_INVALID');
    }
    let affected: number;
    try {
      ({ affected } = await run(
        this.dataSource,
        sql`UPDATE ${TABLE} SET ${c('name')} = ${trimmed}
          WHERE ${c('user_id')} = ${userId} AND ${c('name')} = ${currentName}
            AND ${c('revoked_at')} IS NULL`,
      ));
    } catch (e) {
      if (isUniqueViolation(e)) throw localAuthRefusal('PAT_NAME_TAKEN');
      throw e;
    }
    if (affected === 0) throw localAuthRefusal('PAT_NOT_FOUND');
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('id')}, ${c('name')}, ${c('last_four')} AS ${c('lastFour')},
        ${c('created_at')} AS ${c('createdAt')}, ${c('last_used_at')} AS ${c('lastUsedAt')},
        ${c('expires_at')} AS ${c('expiresAt')}
        FROM ${TABLE}
        WHERE ${c('user_id')} = ${userId} AND ${c('name')} = ${trimmed}
          AND ${c('revoked_at')} IS NULL`,
    );
    return toLocalPat(rows[0] as unknown as PatRow);
  }

  /**
   * Verifies a bearer. A malformed bearer is refused before any query. The
   * active row (not revoked, not expired) is looked up by its SHA-256 hash —
   * never by the token itself — and `last_used_at` is written at most once
   * per 60 s (`staleBefore = now − 60 s`, computed in code). Unknown,
   * revoked or expired → null.
   */
  async verify(
    token: string,
    now: Date,
  ): Promise<{ userId: string; tokenId: string } | null> {
    if (!PAT_PATTERN.test(token)) return null;
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('id')}, ${c('user_id')} AS ${c('userId')}
        FROM ${TABLE}
        WHERE ${c('token_hash')} = ${tokenHash(token)}
          AND ${c('revoked_at')} IS NULL
          AND (${c('expires_at')} IS NULL OR ${c('expires_at')} > ${now})`,
    );
    const row = rows[0] as { id: string; userId: string } | undefined;
    if (!row) return null;
    const staleBefore = new Date(
      now.getTime() - PAT_LAST_USED_WRITE_INTERVAL_MS,
    );
    await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('last_used_at')} = ${now}
        WHERE ${c('id')} = ${row.id}
          AND (${c('last_used_at')} IS NULL OR ${c('last_used_at')} < ${staleBefore})`,
    );
    return { userId: row.userId, tokenId: row.id };
  }

  /**
   * Revokes every active token of the user (a removal from an organisation)
   * and returns the matched rows.
   */
  async revokeAllOfUser(userId: string, now: Date): Promise<number> {
    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('user_id')} = ${userId} AND ${c('revoked_at')} IS NULL`,
    );
    return affected;
  }

  /** The active tokens of the organisation's members. */
  async countActiveForOrganization(
    organizationId: string,
    now: Date,
  ): Promise<number> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT COUNT(*) AS ${c('n')} FROM ${TABLE}
        WHERE ${c('revoked_at')} IS NULL
          AND (${c('expires_at')} IS NULL OR ${c('expires_at')} > ${now})
          AND ${c('user_id')} IN ${membersOf(organizationId)}`,
    );
    return Number(rows[0]?.n);
  }

  /**
   * Revokes every active token of the organisation's members (one UPDATE with
   * an IN subquery, never UPDATE … JOIN) and returns the matched rows.
   */
  async revokeAllForOrganization(
    organizationId: string,
    now: Date,
  ): Promise<number> {
    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('revoked_at')} IS NULL
          AND ${c('user_id')} IN ${membersOf(organizationId)}`,
    );
    return affected;
  }
}
