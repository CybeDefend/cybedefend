import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ident, run, sql } from '@cybedefend/db-dialect';
import { User } from 'src/entities/user.entity';
import { newOpaqueToken, tokenHash } from './token-hash';

/** A password-reset token is valid 30 minutes. */
export const RESET_TTL_MS = 30 * 60 * 1000;
/**
 * The silent cap: at most 3 reset tokens per (requester address, user) per
 * rolling hour. Keyed on the user alone, 3 unauthenticated requests an hour
 * from anyone silently dropped the real user's own mails; per requester, a
 * stranger only exhausts their own share. The number of mails a user can
 * receive stays bounded by the gateway's per-e-mail limit.
 */
export const RESET_LIMIT_PER_HOUR = 3;
/** The rolling hour of the cap, computed in code (never INTERVAL in SQL). */
const RESET_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const TABLE = ident('auth_one_time_token');

/**
 * The requester key of a caller that names none (the admin CLI, a direct
 * caller): 64 zeros, which no HMAC-SHA256 the keyer stores can equal in
 * practice. Callers on the request path always pass the keyer's value
 * (ResetRequesterKeyer: HMAC-SHA256 of the address with the instance's
 * derived key), so the address itself never reaches this store.
 */
export const NO_REQUESTER_KEY = '0'.repeat(64);
const c = ident;

/**
 * The one-time tokens of the Community Edition's LocalAuthModule (instance
 * setup, password reset), in `auth_one_time_token` (the common
 * migration 1786300000000-CreateLocalIdentityTables; only LocalAuthModule reads
 * or writes it). Only the SHA-256 hash of a token is stored, never the token.
 *
 * All SQL goes through libs/db-dialect, so it runs on MySQL and PostgreSQL
 * alike; the `user` table is only touched through the query builder,
 * never named in raw text. `run`'s `affected` counts the rows matched by an
 * UPDATE on both engines.
 */
@Injectable()
export class OneTimeTokenStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Mints a password-reset token for the user. In one transaction, under the
   * user row's lock (`pessimistic_write`: FOR UPDATE on both engines), counts
   * this user's `password_reset` rows of this requester (`opts.requesterKey`,
   * the keyer's HMAC of the client address the gateway sends;
   * {@link NO_REQUESTER_KEY} when absent) with `created_at > since` (`since` = now − 1 h, computed
   * in code): at {@link RESET_LIMIT_PER_HOUR}, returns
   * null (the cap is silent, no refusal code travels); else inserts the row
   * (`created_at = now`, `expires_at = now + 30 min`) and returns the token.
   * The lock comes first, so the count sees the winners' committed rows under
   * concurrency on both engines. `bypassLimit` is the admin CLI's path.
   */
  async createPasswordReset(
    userId: string,
    now: Date,
    opts?: { bypassLimit?: boolean; requesterKey?: string },
  ): Promise<string | null> {
    const since = new Date(now.getTime() - RESET_LIMIT_WINDOW_MS);
    const requesterKey = opts?.requesterKey || NO_REQUESTER_KEY;
    const token = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
    const created = await this.dataSource.transaction(async (manager) => {
      // Serialize concurrent creates of one user: the locking read runs
      // before the count, so the count sees the winners' committed rows.
      await manager
        .getRepository(User)
        .createQueryBuilder('u')
        .setLock('pessimistic_write')
        .where('u.id = :userId', { userId })
        .getOne();
      if (!opts?.bypassLimit) {
        const { rows } = await run(
          manager,
          sql`SELECT COUNT(*) AS ${c('n')} FROM ${TABLE}
            WHERE ${c('user_id')} = ${userId}
              AND ${c('purpose')} = ${'password_reset'}
              AND ${c('requester_key')} = ${requesterKey}
              AND ${c('created_at')} > ${since}`,
        );
        if (Number(rows[0]?.n) >= RESET_LIMIT_PER_HOUR) return false;
      }
      await run(
        manager,
        sql`INSERT INTO ${TABLE} (${c('id')}, ${c('user_id')}, ${c('purpose')}, ${c('token_hash')}, ${c('requester_key')}, ${c('expires_at')}, ${c('consumed_at')}, ${c('attempts')}, ${c('created_at')})
          VALUES (${randomUUID()}, ${userId}, ${'password_reset'}, ${tokenHash(token)}, ${requesterKey}, ${expiresAt}, ${null}, ${0}, ${now})`,
      );
      return true;
    });
    return created ? token : null;
  }

  /**
   * Consumes a password-reset token: one conditional UPDATE sets
   * `consumed_at` and increments `attempts` where the row is an unconsumed,
   * unexpired `password_reset` row of that hash; `affected === 1` means the
   * caller won, and the user id is then read by hash. Anything else (unknown,
   * used, expired token) → null. Single use under concurrency: the losers'
   * UPDATE re-evaluates its WHERE after the winner's row lock, on both
   * engines.
   */
  async consumePasswordReset(
    token: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<string | null> {
    const hash = tokenHash(token);
    const db = manager ?? this.dataSource;
    const { affected } = await run(
      db,
      sql`UPDATE ${TABLE} SET ${c('consumed_at')} = ${now}, ${c('attempts')} = ${c('attempts')} + 1
        WHERE ${c('token_hash')} = ${hash}
          AND ${c('purpose')} = ${'password_reset'}
          AND ${c('consumed_at')} IS NULL
          AND ${c('expires_at')} > ${now}`,
    );
    if (affected !== 1) return null;
    const { rows } = await run(
      db,
      sql`SELECT ${c('user_id')} AS ${c('userId')} FROM ${TABLE}
        WHERE ${c('token_hash')} = ${hash}`,
    );
    const row = rows[0] as { userId: string } | undefined;
    return row?.userId ?? null;
  }

  /**
   * Closes every still-open reset token of the user (`consumed_at = now`),
   * in one UPDATE: after a successful reset the user's other links stop
   * working at once instead of staying valid their 30 minutes. Runs on
   * `manager` when given, so it commits with the new credential. Returns the
   * number of tokens closed. The hourly cap counts `created_at`, so closing a
   * token gives no request back.
   */
  async expireOpenPasswordResets(
    userId: string,
    now: Date,
    manager?: EntityManager,
  ): Promise<number> {
    const { affected } = await run(
      manager ?? this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('consumed_at')} = ${now}
        WHERE ${c('user_id')} = ${userId}
          AND ${c('purpose')} = ${'password_reset'}
          AND ${c('consumed_at')} IS NULL`,
    );
    return affected;
  }
}
