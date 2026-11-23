import {
  ORGANIZATION_DELETION_CODE_FAILURE_WINDOW_MS,
  ORGANIZATION_DELETION_CODE_LOCK_MS,
  ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
  ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY,
  ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR,
  ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS,
  ORGANIZATION_DELETION_CODE_SEND_WINDOW_MS,
  StoredDeletionCode,
} from 'src/modules/organization/organization-deletion-code';
import type {
  ClaimSendOutcome,
  CountAttemptOutcome,
  OrganizationDeletionCodeStore,
} from 'src/modules/organization/organization-deletion-code.store';

interface Row {
  userId: string;
  codeHash: string | null;
  codeSalt: string | null;
  expiresAt: number | null;
  attempts: number;
  sentAt: number | null;
  sendsWindowStart: number | null;
  sendsInWindow: number;
  failuresWindowStart: number | null;
  failuresInWindow: number;
  lockedUntil: number | null;
}

/**
 * The in-memory double of `MysqlOrganizationDeletionCodeStore` for unit
 * specs, statement for statement. Held to the same contract as the SQL
 * (`organization-deletion-code.store.contract.ts`), so it cannot drift.
 */
export class InMemoryOrganizationDeletionCodeStore implements OrganizationDeletionCodeStore {
  readonly rows = new Map<string, Row>();

  async ensureRow(organizationId: string, userId: string): Promise<void> {
    if (this.rows.has(organizationId)) return;
    this.rows.set(organizationId, {
      userId,
      codeHash: null,
      codeSalt: null,
      expiresAt: null,
      attempts: 0,
      sentAt: null,
      sendsWindowStart: null,
      sendsInWindow: 0,
      failuresWindowStart: null,
      failuresInWindow: 0,
      lockedUntil: null,
    });
  }

  private locked(row: Row | undefined, now: number): boolean {
    return !!row && row.lockedUntil !== null && row.lockedUntil > now;
  }

  async claimSend(
    organizationId: string,
    now: Date,
  ): Promise<ClaimSendOutcome> {
    const row = this.rows.get(organizationId);
    const t = now.getTime();
    if (!row) return 'rate_limited';
    if (this.locked(row, t)) return 'locked';
    const windowFloor = t - ORGANIZATION_DELETION_CODE_SEND_WINDOW_MS;
    const newWindow =
      row.sendsWindowStart === null || row.sendsWindowStart <= windowFloor;
    const spaced =
      row.sentAt === null ||
      row.sentAt <= t - ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS;
    if (
      !spaced ||
      (!newWindow &&
        row.sendsInWindow >= ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR)
    ) {
      return 'rate_limited';
    }
    row.sendsInWindow = newWindow ? 1 : row.sendsInWindow + 1;
    row.sendsWindowStart = newWindow ? t : row.sendsWindowStart;
    row.sentAt = t;
    return 'claimed';
  }

  async saveCode(
    organizationId: string,
    userId: string,
    stored: StoredDeletionCode,
    expiresAt: Date,
  ): Promise<void> {
    const row = this.rows.get(organizationId);
    if (!row) return;
    Object.assign(row, {
      userId,
      codeHash: stored.hash,
      codeSalt: stored.salt,
      expiresAt: expiresAt.getTime(),
      attempts: 0,
    });
  }

  async discardCode(organizationId: string, hash: string): Promise<void> {
    const row = this.rows.get(organizationId);
    if (row && row.codeHash === hash) this.clearCode(row);
  }

  private clearCode(row: Row): void {
    row.codeHash = null;
    row.codeSalt = null;
    row.expiresAt = null;
  }

  async isLocked(organizationId: string, now: Date): Promise<boolean> {
    return this.locked(this.rows.get(organizationId), now.getTime());
  }

  async countAttempt(
    organizationId: string,
    userId: string,
    now: Date,
  ): Promise<CountAttemptOutcome> {
    const row = this.rows.get(organizationId);
    const t = now.getTime();
    if (!row) return { outcome: 'invalid' };
    if (this.locked(row, t)) return { outcome: 'locked' };
    const current =
      row.userId === userId &&
      row.codeHash !== null &&
      row.expiresAt !== null &&
      row.expiresAt > t;
    if (!current) return { outcome: 'invalid' };
    if (row.attempts >= ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS) {
      return { outcome: 'exhausted' };
    }
    row.attempts += 1;
    return {
      outcome: 'allowed',
      stored: { hash: row.codeHash!, salt: row.codeSalt! },
    };
  }

  async consume(
    organizationId: string,
    userId: string,
    hash: string,
    now: Date,
  ): Promise<boolean> {
    const row = this.rows.get(organizationId);
    if (
      !row ||
      row.userId !== userId ||
      row.codeHash !== hash ||
      row.expiresAt === null ||
      row.expiresAt <= now.getTime()
    ) {
      return false;
    }
    this.clearCode(row);
    return true;
  }

  async recordFailure(
    organizationId: string,
    now: Date,
  ): Promise<{ lockedUntil: Date | null }> {
    const row = this.rows.get(organizationId);
    const t = now.getTime();
    if (!row) return { lockedUntil: null };
    const newWindow =
      row.failuresWindowStart === null ||
      row.failuresWindowStart <=
        t - ORGANIZATION_DELETION_CODE_FAILURE_WINDOW_MS;
    row.failuresInWindow = newWindow ? 1 : row.failuresInWindow + 1;
    row.failuresWindowStart = newWindow ? t : row.failuresWindowStart;
    if (
      row.failuresInWindow >= ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY &&
      !this.locked(row, t)
    ) {
      row.lockedUntil = t + ORGANIZATION_DELETION_CODE_LOCK_MS;
      this.clearCode(row);
      row.failuresInWindow = 0;
      row.failuresWindowStart = null;
      return { lockedUntil: new Date(row.lockedUntil) };
    }
    return { lockedUntil: null };
  }
}
