import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { ident, run, sql, upsert } from '@cybedefend/db-dialect';
import { localAuthRefusal } from './local-auth-refusals';
import { assertPasswordPolicy } from './password-policy';
import { PasswordHasher } from './password-hasher';
import { OneTimeTokenStore } from './one-time-token.store';

const TABLE = ident('local_credential');
const c = ident;

/**
 * The `local_credential` rows (one per user, the argon2id hash is never
 * logged). The table comes from the common migration
 * 1786300000000-CreateLocalIdentityTables and exists in every edition; only
 * LocalAuthModule, loaded in community mode only, reads or writes it. All SQL
 * goes through libs/db-dialect, so it runs on MySQL and PostgreSQL alike.
 */
@Injectable()
export class LocalCredentialStore {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly oneTimeTokens: OneTimeTokenStore,
  ) {}

  /**
   * Upserts the credential: one row per user (`user_id` is the primary key),
   * `password_changed_at = now`.
   */
  async set(
    manager: EntityManager,
    userId: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    await run(
      manager,
      upsert(
        'local_credential',
        {
          user_id: userId,
          password_hash: passwordHash,
          password_changed_at: now,
        },
        {
          conflict: ['user_id'],
          update: {
            password_hash: 'excluded',
            password_changed_at: 'excluded',
          },
        },
      ),
    );
  }

  /** The stored hash, or null when the user has no local credential. */
  async hashOf(userId: string): Promise<string | null> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('password_hash')} FROM ${TABLE} WHERE ${c('user_id')} = ${userId}`,
    );
    const row = rows[0] as { password_hash?: string } | undefined;
    return row?.password_hash ?? null;
  }

  /**
   * The core of the `ChangePassword` RPC (the handler, which also revokes
   * every session and opens a new one, is LocalAuthService.changePassword). No
   * credential or
   * a wrong current password → CURRENT_PASSWORD_INVALID, never
   * INVALID_CREDENTIALS: the gateway must not sign the user out. Then the
   * policy of the new password, then the new hash written in one transaction,
   * which also closes the user's open password-reset links: a link mailed
   * before the change must not set another password afterwards.
   * `alsoInTransaction` runs in that same transaction, after the write (the
   * caller revokes the user's sessions and tokens there).
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    now: Date,
    alsoInTransaction?: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    await this.assertCurrentPassword(userId, currentPassword);
    assertPasswordPolicy(newPassword);
    // Hashed outside the transaction: argon2 takes ~100 ms, the write is one
    // statement.
    const newHash = await this.hasher.hash(newPassword);
    await this.dataSource.transaction(async (manager) => {
      await this.set(manager, userId, newHash, now);
      await this.oneTimeTokens.expireOpenPasswordResets(userId, now, manager);
      if (alsoInTransaction) await alsoInTransaction(manager);
    });
  }

  /**
   * Proves the caller knows the account's password: no credential or a wrong
   * password → CURRENT_PASSWORD_INVALID (never INVALID_CREDENTIALS: the
   * gateway must not sign the user out). Answers the hash it verified, so a
   * later write can check, under the row's lock, that no reset or change
   * replaced it meanwhile.
   */
  async assertCurrentPassword(
    userId: string,
    currentPassword: string,
  ): Promise<string> {
    const hash = await this.hashOf(userId);
    if (!hash || !(await this.hasher.verify(hash, currentPassword))) {
      throw localAuthRefusal('CURRENT_PASSWORD_INVALID');
    }
    return hash;
  }
}
