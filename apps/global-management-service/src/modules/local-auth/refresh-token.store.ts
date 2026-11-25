import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { ident, run, sql } from '@cybedefend/db-dialect';
import { newOpaqueToken, tokenHash } from './token-hash';

/** A refresh-token family lives 30 days from its first token. */
export const REFRESH_FAMILY_TTL_MS = 30 * 24 * 3600 * 1000;
/** Within 20 s of a rotation, a second use of the old token is a race. */
export const REFRESH_RACE_WINDOW_MS = 20_000;

export type RotateOutcome =
  | { kind: 'rotated'; userId: string; token: string; expiresAt: Date }
  | { kind: 'race' }
  | { kind: 'reused'; userId: string; familyId: string }
  | { kind: 'invalid' };

const TABLE = ident('auth_refresh_token');
const c = ident;

interface RefreshRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

const dateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string | number | Date);

/**
 * The refresh tokens of the Community Edition's LocalAuthModule,
 * in `auth_refresh_token` (the common migration
 * 1786300000000-CreateLocalIdentityTables; only LocalAuthModule reads or
 * writes it). Only the SHA-256 hash of a token is stored, never the token.
 *
 * `rotate` is claim-based, never a read-modify-write: one conditional UPDATE
 * (`rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now`) decides
 * the winner, and `run`'s `affected` counts the rows matched on both engines.
 * Concurrent rotations serialize on the row lock and the losers' UPDATE
 * re-evaluates its WHERE after the winner's commit, so it matches 0 rows on
 * MySQL's REPEATABLE READ and PostgreSQL's READ COMMITTED alike. The
 * rotation first takes a shared lock on the user's `local_credential` row,
 * which a password reset or change holds exclusively, so no replacement token
 * slips past the revocation of a password write. A reuse 20 s
 * or more after the rotation revokes the whole family; `reused` is internal
 * (it drives the log line), the wire answers REFRESH_INVALID like `invalid`.
 */
@Injectable()
export class RefreshTokenStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Opens a new family: one row, `expires_at = now + 30 d`. */
  async issue(
    userId: string,
    now: Date,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + REFRESH_FAMILY_TTL_MS);
    await run(
      this.dataSource,
      sql`INSERT INTO ${TABLE} (${c('id')}, ${c('user_id')}, ${c('family_id')}, ${c('token_hash')}, ${c('expires_at')})
        VALUES (${randomUUID()}, ${userId}, ${randomUUID()}, ${tokenHash(token)}, ${expiresAt})`,
    );
    return { token, expiresAt };
  }

  /**
   * Rotates `token`: claims its row with one conditional UPDATE and inserts
   * the replacement in the same transaction, keeping the family's expiry.
   * A second use within 20 s of the rotation is a `race`; later, it is a
   * `reused` and revokes the whole family. Unknown, revoked or expired: `invalid`.
   */
  async rotate(token: string, now: Date): Promise<RotateOutcome> {
    const hash = tokenHash(token);
    const row = await this.readRow(hash);
    if (!row) return { kind: 'invalid' };

    const newToken = newOpaqueToken();
    const newId = randomUUID();
    const claimed = await this.dataSource.transaction(async (manager) => {
      // Ordered against a password write: a reset or change holds this row
      // exclusively for its whole transaction. Either the rotation waits and
      // its claim then finds the token revoked, or the password write waits
      // and its revocation sees the replacement inserted here.
      await run(
        manager,
        sql`SELECT ${c('user_id')} FROM ${ident('local_credential')}
          WHERE ${c('user_id')} = ${row.userId} FOR SHARE`,
      );
      const { affected } = await run(
        manager,
        sql`UPDATE ${TABLE} SET ${c('rotated_at')} = ${now}, ${c('replaced_by')} = ${newId}
          WHERE ${c('id')} = ${row.id}
            AND ${c('rotated_at')} IS NULL
            AND ${c('revoked_at')} IS NULL
            AND ${c('expires_at')} > ${now}`,
      );
      if (affected !== 1) return false;
      await run(
        manager,
        sql`INSERT INTO ${TABLE} (${c('id')}, ${c('user_id')}, ${c('family_id')}, ${c('token_hash')}, ${c('expires_at')})
          VALUES (${newId}, ${row.userId}, ${row.familyId}, ${tokenHash(newToken)}, ${row.expiresAt})`,
      );
      return true;
    });
    if (claimed) {
      return {
        kind: 'rotated',
        userId: row.userId,
        token: newToken,
        expiresAt: row.expiresAt,
      };
    }

    // The claim lost: re-read the row now that the winner has committed.
    const after = await this.readRow(hash);
    if (!after) return { kind: 'invalid' };
    if (
      after.revokedAt !== null ||
      after.expiresAt.getTime() <= now.getTime()
    ) {
      return { kind: 'invalid' };
    }
    if (
      after.rotatedAt !== null &&
      now.getTime() - after.rotatedAt.getTime() < REFRESH_RACE_WINDOW_MS
    ) {
      return { kind: 'race' };
    }
    // A reuse 20 s or more after the rotation: revoke the whole family.
    await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('family_id')} = ${after.familyId} AND ${c('revoked_at')} IS NULL`,
    );
    return { kind: 'reused', userId: after.userId, familyId: after.familyId };
  }

  /** Logout: revokes the family of `token`; an unknown token is a no-op. */
  async revokeFamilyOf(token: string, now: Date): Promise<void> {
    const row = await this.readRow(tokenHash(token));
    if (!row) return;
    await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('family_id')} = ${row.familyId} AND ${c('revoked_at')} IS NULL`,
    );
  }

  /**
   * After a password reset or change: revokes every family of the user. With
   * `manager`, inside the caller's transaction (the one that writes the new
   * password), so the password and the sign-out commit together.
   */
  async revokeAllOfUser(
    userId: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<void> {
    await run(
      manager ?? this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('revoked_at')} = ${now}
        WHERE ${c('user_id')} = ${userId} AND ${c('revoked_at')} IS NULL`,
    );
  }

  private async readRow(hash: string): Promise<RefreshRow | undefined> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('id')}, ${c('user_id')} AS ${c('userId')}, ${c('family_id')} AS ${c('familyId')},
        ${c('expires_at')} AS ${c('expiresAt')}, ${c('rotated_at')} AS ${c('rotatedAt')}, ${c('revoked_at')} AS ${c('revokedAt')}
        FROM ${TABLE} WHERE ${c('token_hash')} = ${hash}`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      userId: row.userId as string,
      familyId: row.familyId as string,
      expiresAt: new Date(row.expiresAt as string | number | Date),
      rotatedAt: dateOrNull(row.rotatedAt),
      revokedAt: dateOrNull(row.revokedAt),
    };
  }
}
