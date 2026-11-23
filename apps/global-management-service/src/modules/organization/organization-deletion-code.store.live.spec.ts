import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { dialectApi, run, type DialectApi } from '@cybedefend/db-dialect';
import { createLiveDatabase, liveEnabled } from 'src/core/db/live-database';
import { Organization } from 'src/entities/organization.entity';
import { User } from 'src/entities/user.entity';
import { MysqlOrganizationDeletionCodeStore } from './organization-deletion-code.store';
import { describeOrganizationDeletionCodeStoreContract } from './organization-deletion-code.store.contract';
import {
  ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
  ORGANIZATION_DELETION_CODE_TTL_MS,
} from './organization-deletion-code';

/**
 * LIVE spec of the organization deletion code store against a REAL MySQL or
 * PostgreSQL, built by the migrations of global-management.
 *
 * Mocks only show that each limit is one conditional UPDATE decided by
 * `affected === 1`; that MySQL serializes concurrent ones (mysql2 reports
 * FOUND rows, so only the WHERE decides) needs the real engine: concurrent attempts
 * never exceed 5, concurrent sends never exceed the limits, and two
 * concurrent correct confirmations consume the code once.
 *
 * Skipped unless `ORG_DELETION_CODE_LIVE=1` (or the former
 * `ORG_DELETION_CODE_MYSQL_LIVE=1`, which means MySQL), so `pnpm run test`
 * stays hermetic. The engine is `LIVE_DB_TYPE` (mysql by default). It creates
 * a throwaway database and drops it at the end.
 *
 *   ORG_DELETION_CODE_LIVE=1 LIVE_DB_TYPE=mysql \
 *     ORG_DELETION_CODE_MYSQL_URL=mysql://root:<password>@127.0.0.1:3308 \
 *     pnpm exec jest --testPathPatterns=organization-deletion-code.store.live --runInBand
 *   ORG_DELETION_CODE_LIVE=1 LIVE_DB_TYPE=postgres \
 *     ORG_DELETION_CODE_PG_URL=postgres://postgres:postgres@127.0.0.1:5432 \
 *     pnpm exec jest --testPathPatterns=organization-deletion-code.store.live --runInBand
 */
const LIVE = liveEnabled('ORG_DELETION_CODE');
const describeLive = LIVE ? describe : describe.skip;

describeLive('OrganizationDeletionCodeStore on a real database', () => {
  jest.setTimeout(180_000);

  let dataSource: DataSource;
  let drop: () => Promise<void>;
  let store: MysqlOrganizationDeletionCodeStore;
  let db: DialectApi;

  beforeAll(async () => {
    let dialect: 'mysql' | 'postgres';
    ({ dataSource, drop, dialect } = await createLiveDatabase({
      prefix: 'gm_org_deletion_code',
      envPrefix: 'ORG_DELETION_CODE',
      extra: { connectionLimit: 20, max: 20 },
    }));
    db = dialectApi(dialect);
    store = new MysqlOrganizationDeletionCodeStore(dataSource);
  });

  /** The organization's row as stored. */
  async function codeRow(organizationId: string) {
    const { rows } = await run(
      dataSource,
      db.sql`SELECT ${db.ident('attempts')} AS ${db.ident('attempts')}, ${db.ident('sendsInWindow')} AS ${db.ident('sendsInWindow')}, ${db.ident('failuresInWindow')} AS ${db.ident('failuresInWindow')} FROM ${db.ident('organization_deletion_code')} WHERE ${db.ident('organizationId')} = ${organizationId}`,
    );
    return rows[0] as
      | { attempts: number; sendsInWindow: number; failuresInWindow: number }
      | undefined;
  }

  afterAll(async () => {
    await drop?.();
  });

  async function organization() {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: randomUUID(),
        email: `creator-${randomUUID()}@example.test`,
        firstName: 'C',
        lastName: 'R',
        picture: '',
      } as Partial<User>),
    );
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        name: 'Org',
        industry: 'it',
        country: 'FR',
        creator: user,
      } as Partial<Organization>),
    );
    return { organizationId: org.id, userId: user.id };
  }

  describe('contract', () => {
    describeOrganizationDeletionCodeStoreContract(async () => ({
      store,
      ...(await organization()),
    }));
  });

  const STORED = { hash: 'e'.repeat(64), salt: 'f'.repeat(32) };
  const T0 = new Date('2026-10-27T10:00:00.000Z');

  it('the claim, attempt and failure counters decide on the same affected rows on both engines', async () => {
    const { organizationId, userId } = await organization();
    // ensureRow twice: the second is a no-op, never an error.
    await store.ensureRow(organizationId, userId);
    await store.ensureRow(organizationId, userId);

    // A claim on an empty row is claimed; a second within 60 s is not.
    await expect(store.claimSend(organizationId, T0)).resolves.toBe('claimed');
    await expect(
      store.claimSend(organizationId, new Date(T0.getTime() + 30_000)),
    ).resolves.toBe('rate_limited');
    expect(Number((await codeRow(organizationId)).sendsInWindow)).toBe(1);
    // A minute later the window counts on.
    await expect(
      store.claimSend(organizationId, new Date(T0.getTime() + 60_000)),
    ).resolves.toBe('claimed');
    expect(Number((await codeRow(organizationId)).sendsInWindow)).toBe(2);

    // Five counted attempts, then the sixth refused.
    await store.saveCode(
      organizationId,
      userId,
      STORED,
      new Date(T0.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS),
    );
    for (let i = 0; i < ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS; i++) {
      await expect(
        store.countAttempt(organizationId, userId, T0),
      ).resolves.toEqual({ outcome: 'allowed', stored: STORED });
    }
    await expect(
      store.countAttempt(organizationId, userId, T0),
    ).resolves.toEqual({ outcome: 'exhausted' });
    expect(Number((await codeRow(organizationId)).attempts)).toBe(
      ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
    );

    // The failure window counts, and the tenth failure locks once.
    for (let i = 0; i < 9; i++) {
      await expect(store.recordFailure(organizationId, T0)).resolves.toEqual({
        lockedUntil: null,
      });
    }
    expect(Number((await codeRow(organizationId)).failuresInWindow)).toBe(9);
    const tenth = await store.recordFailure(organizationId, T0);
    expect(tenth.lockedUntil).toEqual(expect.any(Date));
    await expect(store.isLocked(organizationId, T0)).resolves.toBe(true);
    await expect(store.claimSend(organizationId, T0)).resolves.toBe('locked');

    // A consumed code is consumed once.
    const other = await organization();
    await store.ensureRow(other.organizationId, other.userId);
    await store.saveCode(
      other.organizationId,
      other.userId,
      STORED,
      new Date(T0.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS),
    );
    await expect(
      store.consume(other.organizationId, other.userId, STORED.hash, T0),
    ).resolves.toBe(true);
    await expect(
      store.consume(other.organizationId, other.userId, STORED.hash, T0),
    ).resolves.toBe(false);
  });

  it('the row goes with its organization (FK cascade)', async () => {
    const { organizationId, userId } = await organization();
    await store.ensureRow(organizationId, userId);
    await dataSource.getRepository(Organization).delete(organizationId);
    await expect(codeRow(organizationId)).resolves.toBeUndefined();
  });

  it(`20 concurrent attempts on one code: exactly ${ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS} allowed`, async () => {
    const { organizationId, userId } = await organization();
    await store.ensureRow(organizationId, userId);
    await store.saveCode(
      organizationId,
      userId,
      STORED,
      new Date(T0.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS),
    );
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.countAttempt(organizationId, userId, T0),
      ),
    );
    const allowed = outcomes.filter((o) => o.outcome === 'allowed').length;
    const exhausted = outcomes.filter((o) => o.outcome === 'exhausted').length;
    console.log(`LIVE attempts: allowed=${allowed} exhausted=${exhausted}`);
    expect(allowed).toBe(ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS);
    expect(exhausted).toBe(20 - ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS);
    expect(Number((await codeRow(organizationId)).attempts)).toBe(
      ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
    );
  });

  it('20 concurrent sends at the same instant: exactly one claimed', async () => {
    const { organizationId, userId } = await organization();
    await store.ensureRow(organizationId, userId);
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => store.claimSend(organizationId, T0)),
    );
    const claimed = outcomes.filter((o) => o === 'claimed').length;
    console.log(`LIVE sends at one instant: claimed=${claimed}`);
    expect(claimed).toBe(1);
  });

  it('concurrent sends spread over an hour: never more than 3 claimed', async () => {
    const { organizationId, userId } = await organization();
    await store.ensureRow(organizationId, userId);
    // Ten bursts a minute apart, each of 10 concurrent requests: the 60 s
    // spacing alone would allow 10, the hourly cap allows 3.
    let claimed = 0;
    for (let minute = 0; minute < 10; minute++) {
      const now = new Date(T0.getTime() + minute * 60_000);
      const burst = await Promise.all(
        Array.from({ length: 10 }, () => store.claimSend(organizationId, now)),
      );
      const won = burst.filter((o) => o === 'claimed').length;
      expect(won).toBeLessThanOrEqual(1);
      claimed += won;
    }
    console.log(`LIVE sends over 10 minutes: claimed=${claimed}`);
    expect(claimed).toBe(3);
  });

  it('two concurrent consumptions of one correct code: exactly one wins', async () => {
    for (let round = 0; round < 10; round++) {
      const { organizationId, userId } = await organization();
      await store.ensureRow(organizationId, userId);
      await store.saveCode(
        organizationId,
        userId,
        STORED,
        new Date(T0.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS),
      );
      const results = await Promise.all([
        store.consume(organizationId, userId, STORED.hash, T0),
        store.consume(organizationId, userId, STORED.hash, T0),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    }
    console.log('LIVE consume: 10 rounds, one winner each');
  });

  it('attempts racing with a new code: an attempt allowed on a code was counted on that code', async () => {
    const A = { hash: '1'.repeat(64), salt: '2'.repeat(32) };
    const B = { hash: '3'.repeat(64), salt: '4'.repeat(32) };
    const expiresAt = new Date(
      T0.getTime() + ORGANIZATION_DELETION_CODE_TTL_MS,
    );
    let mismatches = 0;
    for (let round = 0; round < 30; round++) {
      const { organizationId, userId } = await organization();
      await store.ensureRow(organizationId, userId);
      await store.saveCode(organizationId, userId, A, expiresAt);
      const attempts = Array.from({ length: 4 }, () =>
        store.countAttempt(organizationId, userId, T0),
      );
      const replaced = store.saveCode(organizationId, userId, B, expiresAt);
      const outcomes = await Promise.all(attempts);
      await replaced;
      const onB = outcomes.filter(
        (o) => o.outcome === 'allowed' && o.stored.hash === B.hash,
      ).length;
      const attemptsLeft = Number((await codeRow(organizationId)).attempts);
      // saveCode resets the attempts: those left on B are exactly the
      // attempts allowed on B.
      if (attemptsLeft !== onB) mismatches++;
      expect(attemptsLeft).toBe(onB);
    }
    console.log(
      `LIVE attempts racing a new code: 30 rounds, mismatches=${mismatches}`,
    );
  });

  it('concurrent failures lock once, never twice, and not below the threshold', async () => {
    const below = await organization();
    await store.ensureRow(below.organizationId, below.userId);
    const nine = await Promise.all(
      Array.from({ length: 9 }, () =>
        store.recordFailure(below.organizationId, T0),
      ),
    );
    expect(nine.filter((r) => r.lockedUntil !== null)).toHaveLength(0);
    await expect(store.isLocked(below.organizationId, T0)).resolves.toBe(false);

    let locks = 0;
    for (let round = 0; round < 10; round++) {
      const { organizationId, userId } = await organization();
      await store.ensureRow(organizationId, userId);
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          store.recordFailure(organizationId, T0),
        ),
      );
      const locked = results.filter((r) => r.lockedUntil !== null).length;
      expect(locked).toBe(1);
      locks += locked;
      await expect(store.isLocked(organizationId, T0)).resolves.toBe(true);
    }
    console.log(`LIVE concurrent failures: 10 rounds of 25, locks=${locks}`);
  });
});
