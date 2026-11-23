import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ident, ifThen, run, sql, upsert } from '@cybedefend/db-dialect';
import {
  ORGANIZATION_DELETION_CODE_FAILURE_WINDOW_MS,
  ORGANIZATION_DELETION_CODE_LOCK_MS,
  ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
  ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY,
  ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR,
  ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS,
  ORGANIZATION_DELETION_CODE_SEND_WINDOW_MS,
  StoredDeletionCode,
} from './organization-deletion-code';

export type ClaimSendOutcome = 'claimed' | 'locked' | 'rate_limited';

export type CountAttemptOutcome =
  | { outcome: 'allowed'; stored: StoredDeletionCode }
  | { outcome: 'locked' | 'exhausted' | 'invalid' };

/**
 * The organization deletion code's row (`organization_deletion_code`). Every
 * limit is decided by ONE conditional statement, so concurrent requests
 * cannot exceed it. Times come from the caller's clock (`now`), so the specs
 * drive the TTL, the windows and the lock without waiting.
 *
 * The contract both implementations satisfy is
 * `organization-deletion-code.store.contract.ts`.
 */
export interface OrganizationDeletionCodeStore {
  /** Creates the organization's row if it has none. */
  ensureRow(organizationId: string, userId: string): Promise<void>;
  /** Claims one send: not locked, 60 s since the last, 3 an hour. */
  claimSend(organizationId: string, now: Date): Promise<ClaimSendOutcome>;
  /** Replaces the current code (its attempts start at 0). */
  saveCode(
    organizationId: string,
    userId: string,
    stored: StoredDeletionCode,
    expiresAt: Date,
  ): Promise<void>;
  /** Removes the code if it is still the one hashed `hash` (a failed mail). */
  discardCode(organizationId: string, hash: string): Promise<void>;
  isLocked(organizationId: string, now: Date): Promise<boolean>;
  /** Counts one attempt BEFORE the comparison; 5 per code. */
  countAttempt(
    organizationId: string,
    userId: string,
    now: Date,
  ): Promise<CountAttemptOutcome>;
  /** Consumes the code hashed `hash`: true for exactly one caller. */
  consume(
    organizationId: string,
    userId: string,
    hash: string,
    now: Date,
  ): Promise<boolean>;
  /**
   * Records a failed comparison. `lockedUntil` is set only for the call
   * whose failure locked the deletion (10 within 24 h), so the alert mail
   * goes once.
   */
  recordFailure(
    organizationId: string,
    now: Date,
  ): Promise<{ lockedUntil: Date | null }>;
}

const TABLE = ident('organization_deletion_code');
const c = ident;

interface CodeRow {
  userId: string;
  codeHash: string | null;
  codeSalt: string | null;
  expiresAt: Date | null;
  attempts: number;
  lockedUntil: Date | null;
}

// `run(...).affected` is the rows the WHERE matched on both engines (mysql2
// reports FOUND rows, pg its rowCount), so every condition that decides lives
// in the WHERE.

const ms = (date: Date, delta: number) => new Date(date.getTime() + delta);

@Injectable()
export class MysqlOrganizationDeletionCodeStore implements OrganizationDeletionCodeStore {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async ensureRow(organizationId: string, userId: string): Promise<void> {
    // A no-op self-assignment on a duplicate, as before on MySQL (an
    // INSERT IGNORE would also hide a foreign-key error there). The column is
    // qualified by its table: unqualified, PostgreSQL finds it ambiguous with
    // the EXCLUDED row.
    await run(
      this.dataSource,
      upsert(
        'organization_deletion_code',
        { organizationId, userId },
        {
          conflict: ['organizationId'],
          update: {
            organizationId: c('organization_deletion_code.organizationId'),
          },
        },
      ),
    );
  }

  async claimSend(
    organizationId: string,
    now: Date,
  ): Promise<ClaimSendOutcome> {
    const windowFloor = ms(now, -ORGANIZATION_DELETION_CODE_SEND_WINDOW_MS);
    const lastSendFloor = ms(
      now,
      -ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS,
    );
    // MySQL applies single-table SET assignments left to right, PostgreSQL
    // reads every one from the old row: either way the count is computed from
    // the window start before the window start moves.
    const windowOver = sql`${c('sendsWindowStart')} IS NULL OR ${c('sendsWindowStart')} <= ${windowFloor}`;
    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET
         ${c('sendsInWindow')} = ${ifThen(windowOver, '1', sql`${c('sendsInWindow')} + 1`)},
         ${c('sendsWindowStart')} = ${ifThen(windowOver, sql`${now}`, c('sendsWindowStart'))},
         ${c('sentAt')} = ${now}
       WHERE ${c('organizationId')} = ${organizationId}
         AND (${c('lockedUntil')} IS NULL OR ${c('lockedUntil')} <= ${now})
         AND (${c('sentAt')} IS NULL OR ${c('sentAt')} <= ${lastSendFloor})
         AND (${c('sendsWindowStart')} IS NULL OR ${c('sendsWindowStart')} <= ${windowFloor} OR ${c('sendsInWindow')} < ${ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR})`,
    );
    if (affected === 1) return 'claimed';
    return (await this.isLocked(organizationId, now))
      ? 'locked'
      : 'rate_limited';
  }

  async saveCode(
    organizationId: string,
    userId: string,
    stored: StoredDeletionCode,
    expiresAt: Date,
  ): Promise<void> {
    await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('userId')} = ${userId}, ${c('codeHash')} = ${stored.hash}, ${c('codeSalt')} = ${stored.salt}, ${c('expiresAt')} = ${expiresAt}, ${c('attempts')} = 0
       WHERE ${c('organizationId')} = ${organizationId}`,
    );
  }

  async discardCode(organizationId: string, hash: string): Promise<void> {
    await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('codeHash')} = NULL, ${c('codeSalt')} = NULL, ${c('expiresAt')} = NULL
       WHERE ${c('organizationId')} = ${organizationId} AND ${c('codeHash')} = ${hash}`,
    );
  }

  async isLocked(organizationId: string, now: Date): Promise<boolean> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT 1 AS ${c('locked')} FROM ${TABLE} WHERE ${c('organizationId')} = ${organizationId} AND ${c('lockedUntil')} > ${now}`,
    );
    return rows.length > 0;
  }

  async countAttempt(
    organizationId: string,
    userId: string,
    now: Date,
  ): Promise<CountAttemptOutcome> {
    // The code is read FIRST and the attempt counted on that very code
    // (`codeHash = ?`): a saveCode between the two statements makes the
    // count miss, so an attempt is never counted on one code and compared
    // with another.
    const before = await this.readRow(organizationId);
    const refused = this.refusalOf(before, userId, now);
    if (refused) return refused;

    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('attempts')} = ${c('attempts')} + 1
       WHERE ${c('organizationId')} = ${organizationId} AND ${c('userId')} = ${userId} AND ${c('codeHash')} = ${before.codeHash}
         AND ${c('expiresAt')} > ${now} AND ${c('attempts')} < ${ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS}
         AND (${c('lockedUntil')} IS NULL OR ${c('lockedUntil')} <= ${now})`,
    );
    if (affected === 1) {
      return {
        outcome: 'allowed',
        stored: { hash: before.codeHash, salt: before.codeSalt },
      };
    }
    // Something moved in between: say why from the row as it is now, but
    // never allow (the code compared must be the one counted). A replaced or
    // consumed code is invalid.
    const current = await this.readRow(organizationId);
    const after = this.refusalOf(current, userId, now);
    if (after?.outcome === 'locked') return after;
    // Exhausted only if the used-up attempts are those of the code read above.
    if (
      after?.outcome === 'exhausted' &&
      current?.codeHash === before.codeHash
    ) {
      return after;
    }
    return { outcome: 'invalid' };
  }

  private async readRow(organizationId: string): Promise<CodeRow | undefined> {
    const { rows } = await run(
      this.dataSource,
      sql`SELECT ${c('userId')}, ${c('codeHash')}, ${c('codeSalt')}, ${c('expiresAt')}, ${c('attempts')}, ${c('lockedUntil')}
       FROM ${TABLE} WHERE ${c('organizationId')} = ${organizationId}`,
    );
    return rows[0] as unknown as CodeRow | undefined;
  }

  /** Why `row` allows no attempt for `userId` at `now`, or null if it does. */
  private refusalOf(
    row: CodeRow | undefined,
    userId: string,
    now: Date,
  ): Exclude<CountAttemptOutcome, { outcome: 'allowed' }> | null {
    if (!row) return { outcome: 'invalid' };
    if (row.lockedUntil && new Date(row.lockedUntil) > now) {
      return { outcome: 'locked' };
    }
    const current =
      row.userId === userId &&
      row.codeHash !== null &&
      row.codeSalt !== null &&
      row.expiresAt !== null &&
      new Date(row.expiresAt) > now;
    if (!current) return { outcome: 'invalid' };
    if (Number(row.attempts) >= ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS) {
      return { outcome: 'exhausted' };
    }
    return null;
  }

  async consume(
    organizationId: string,
    userId: string,
    hash: string,
    now: Date,
  ): Promise<boolean> {
    const { affected } = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('codeHash')} = NULL, ${c('codeSalt')} = NULL, ${c('expiresAt')} = NULL
       WHERE ${c('organizationId')} = ${organizationId} AND ${c('userId')} = ${userId} AND ${c('codeHash')} = ${hash} AND ${c('expiresAt')} > ${now}`,
    );
    return affected === 1;
  }

  async recordFailure(
    organizationId: string,
    now: Date,
  ): Promise<{ lockedUntil: Date | null }> {
    const windowFloor = ms(now, -ORGANIZATION_DELETION_CODE_FAILURE_WINDOW_MS);
    const windowOver = sql`${c('failuresWindowStart')} IS NULL OR ${c('failuresWindowStart')} <= ${windowFloor}`;
    await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET
         ${c('failuresInWindow')} = ${ifThen(windowOver, '1', sql`${c('failuresInWindow')} + 1`)},
         ${c('failuresWindowStart')} = ${ifThen(windowOver, sql`${now}`, c('failuresWindowStart'))}
       WHERE ${c('organizationId')} = ${organizationId}`,
    );
    // One statement sets the lock, so only one failure ever sets it: it also
    // removes the current code and resets the count for after the lock.
    const lockedUntil = ms(now, ORGANIZATION_DELETION_CODE_LOCK_MS);
    const locked = await run(
      this.dataSource,
      sql`UPDATE ${TABLE} SET ${c('lockedUntil')} = ${lockedUntil}, ${c('codeHash')} = NULL, ${c('codeSalt')} = NULL, ${c('expiresAt')} = NULL,
         ${c('failuresInWindow')} = 0, ${c('failuresWindowStart')} = NULL
       WHERE ${c('organizationId')} = ${organizationId} AND ${c('failuresInWindow')} >= ${ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY}
         AND (${c('lockedUntil')} IS NULL OR ${c('lockedUntil')} <= ${now})`,
    );
    return { lockedUntil: locked.affected === 1 ? lockedUntil : null };
  }
}
