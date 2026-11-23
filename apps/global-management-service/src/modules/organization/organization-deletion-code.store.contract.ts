import type { OrganizationDeletionCodeStore } from './organization-deletion-code.store';
import {
  ORGANIZATION_DELETION_CODE_LOCK_MS,
  ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
  ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY,
  ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR,
  ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS,
  ORGANIZATION_DELETION_CODE_TTL_MS,
} from './organization-deletion-code';

/**
 * What every `OrganizationDeletionCodeStore` must do, run against the MySQL
 * store (`organization-deletion-code.store.live.spec.ts`, real SQL) and
 * against the in-memory double the unit specs use
 * (`organization-deletion-code.store.memory.spec.ts`): the double cannot
 * drift from the SQL without one of the two failing.
 *
 * `makeStore` returns a store and a fresh organization id (with its creator)
 * that exists where the store needs it (the MySQL row has an FK).
 */
export interface StoreUnderTest {
  store: OrganizationDeletionCodeStore;
  organizationId: string;
  userId: string;
}

const STORED = { hash: 'a'.repeat(64), salt: 'b'.repeat(32) };
const OTHER = { hash: 'c'.repeat(64), salt: 'd'.repeat(32) };

/** A whole-second base: MySQL datetime(3) keeps milliseconds only. */
const T0 = new Date('2026-10-27T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

export function describeOrganizationDeletionCodeStoreContract(
  makeStore: () => Promise<StoreUnderTest>,
): void {
  let s: StoreUnderTest;
  beforeEach(async () => {
    s = await makeStore();
    await s.store.ensureRow(s.organizationId, s.userId);
  });

  const send = (now: Date) => s.store.claimSend(s.organizationId, now);
  const save = (stored = STORED, now = T0) =>
    s.store.saveCode(
      s.organizationId,
      s.userId,
      stored,
      new Date(now.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS),
    );
  const attempt = (now: Date, userId = s.userId) =>
    s.store.countAttempt(s.organizationId, userId, now);

  describe('sends', () => {
    it('ensureRow twice keeps one row and its counters', async () => {
      await expect(send(T0)).resolves.toBe('claimed');
      await s.store.ensureRow(s.organizationId, s.userId);
      await expect(send(at(30_000))).resolves.toBe('rate_limited');
    });

    it(`waits ${ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS} ms between two sends`, async () => {
      await expect(send(T0)).resolves.toBe('claimed');
      await expect(send(at(59_999))).resolves.toBe('rate_limited');
      await expect(send(at(60_000))).resolves.toBe('claimed');
    });

    it(`sends at most ${ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR} codes an hour`, async () => {
      await expect(send(T0)).resolves.toBe('claimed');
      await expect(send(at(1 * MIN))).resolves.toBe('claimed');
      await expect(send(at(2 * MIN))).resolves.toBe('claimed');
      await expect(send(at(3 * MIN))).resolves.toBe('rate_limited');
      await expect(send(at(59 * MIN))).resolves.toBe('rate_limited');
      // The window opened at the first send: an hour later it is a new one.
      await expect(send(at(60 * MIN))).resolves.toBe('claimed');
    });
  });

  describe('attempts', () => {
    it('no code: invalid', async () => {
      await expect(attempt(T0)).resolves.toEqual({ outcome: 'invalid' });
    });

    it('a saved code is allowed and hands back its hash and salt', async () => {
      await save();
      await expect(attempt(at(1000))).resolves.toEqual({
        outcome: 'allowed',
        stored: STORED,
      });
    });

    it('valid at 9:59, refused at 10:01 (and at exactly 10:00)', async () => {
      await save();
      await expect(attempt(at(9 * MIN + 59_000))).resolves.toMatchObject({
        outcome: 'allowed',
      });
      await expect(attempt(at(10 * MIN))).resolves.toEqual({
        outcome: 'invalid',
      });
      await expect(attempt(at(10 * MIN + 1000))).resolves.toEqual({
        outcome: 'invalid',
      });
    });

    it('another user than the one the code was sent to: invalid', async () => {
      await save();
      await expect(attempt(at(1000), 'someone-else')).resolves.toEqual({
        outcome: 'invalid',
      });
    });

    it(`${ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS} attempts per code, then exhausted`, async () => {
      await save();
      for (let i = 0; i < ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS; i++) {
        await expect(attempt(at(1000 + i))).resolves.toMatchObject({
          outcome: 'allowed',
        });
      }
      await expect(attempt(at(2000))).resolves.toEqual({
        outcome: 'exhausted',
      });
    });

    it('a new code replaces the previous one and its attempts', async () => {
      await save();
      for (let i = 0; i < ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS; i++) {
        await attempt(at(1000));
      }
      await save(OTHER, at(2 * MIN));
      await expect(attempt(at(3 * MIN))).resolves.toEqual({
        outcome: 'allowed',
        stored: OTHER,
      });
    });

    it('discardCode removes the code only while it is still that code', async () => {
      await save(OTHER);
      await s.store.discardCode(s.organizationId, STORED.hash);
      await expect(attempt(at(1000))).resolves.toMatchObject({
        outcome: 'allowed',
      });
      await s.store.discardCode(s.organizationId, OTHER.hash);
      await expect(attempt(at(2000))).resolves.toEqual({ outcome: 'invalid' });
    });
  });

  describe('consume', () => {
    it('succeeds once', async () => {
      await save();
      await expect(
        s.store.consume(s.organizationId, s.userId, STORED.hash, at(1000)),
      ).resolves.toBe(true);
      await expect(
        s.store.consume(s.organizationId, s.userId, STORED.hash, at(1000)),
      ).resolves.toBe(false);
      await expect(attempt(at(2000))).resolves.toEqual({ outcome: 'invalid' });
    });

    it('refuses a replaced, expired or foreign code', async () => {
      await save(OTHER);
      await expect(
        s.store.consume(s.organizationId, s.userId, STORED.hash, at(1000)),
      ).resolves.toBe(false);
      await expect(
        s.store.consume(s.organizationId, 'someone-else', OTHER.hash, at(1000)),
      ).resolves.toBe(false);
      await expect(
        s.store.consume(s.organizationId, s.userId, OTHER.hash, at(10 * MIN)),
      ).resolves.toBe(false);
    });
  });

  describe('failures and the lock', () => {
    const fail = (now: Date) => s.store.recordFailure(s.organizationId, now);

    it(`${ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY} failures within 24 h lock the deletion for 24 h, once`, async () => {
      await save();
      for (
        let i = 1;
        i < ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY;
        i++
      ) {
        await expect(fail(at(i * MIN))).resolves.toEqual({ lockedUntil: null });
      }
      await expect(
        s.store.isLocked(s.organizationId, at(10 * MIN)),
      ).resolves.toBe(false);
      const tenth = at(10 * MIN);
      await expect(fail(tenth)).resolves.toEqual({
        lockedUntil: new Date(
          tenth.getTime() + ORGANIZATION_DELETION_CODE_LOCK_MS,
        ),
      });
      // An eleventh failure does not lock (nor alert) a second time.
      await expect(fail(at(11 * MIN))).resolves.toEqual({ lockedUntil: null });

      const during = at(10 * MIN + ORGANIZATION_DELETION_CODE_LOCK_MS - 1);
      await expect(s.store.isLocked(s.organizationId, during)).resolves.toBe(
        true,
      );
      await expect(send(during)).resolves.toBe('locked');
      await expect(attempt(during)).resolves.toEqual({ outcome: 'locked' });

      const after = at(10 * MIN + ORGANIZATION_DELETION_CODE_LOCK_MS);
      await expect(s.store.isLocked(s.organizationId, after)).resolves.toBe(
        false,
      );
      // The lock removed the code that was current when it was set.
      await expect(attempt(after)).resolves.toEqual({ outcome: 'invalid' });
      await expect(send(after)).resolves.toBe('claimed');
    });

    it('failures older than 24 h do not count', async () => {
      for (
        let i = 0;
        i < ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY - 1;
        i++
      ) {
        await fail(at(i * MIN));
      }
      // The window opened at the first failure: 24 h later, a new one.
      const nextDay = at(ORGANIZATION_DELETION_CODE_LOCK_MS);
      await expect(fail(nextDay)).resolves.toEqual({ lockedUntil: null });
      await expect(s.store.isLocked(s.organizationId, nextDay)).resolves.toBe(
        false,
      );
    });
  });
}
