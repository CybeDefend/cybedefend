import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { dialectApi, run } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import { User } from 'src/entities/user.entity';
import {
  RESET_LIMIT_PER_HOUR,
  RESET_TTL_MS,
  OneTimeTokenStore,
} from './one-time-token.store';

/**
 * LIVE spec of the one-time token store against a REAL MySQL or
 * PostgreSQL, built by the real migrations of global-management (both engines).
 * The unit spec pins the statements; only the real
 * engines prove what they do under concurrency: six parallel creates let
 * exactly three tokens through (the user row's FOR UPDATE serialises them and
 * the count sees the winners' committed rows), and ten parallel consumes of
 * one token let exactly one through (the conditional UPDATE's `affected`
 * counts the matched rows on both engines).
 *
 * Skipped unless LOCAL_AUTH_LIVE=1, so `pnpm run test` stays hermetic. The
 * engine is LIVE_DB_TYPE (mysql by default). It creates a throwaway database
 * and drops it at the end. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=one-time-token.store.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=one-time-token.store.live
 */
const LIVE = liveEnabled('LOCAL_AUTH');
const describeLive = LIVE ? describe : describe.skip;

/** The service root (`src/`), where the entity globs point. */
const ROOT = join(__dirname, '..', '..');
const LOCAL_AUTH_ENTITIES = join(
  ROOT,
  'modules',
  'local-auth',
  'entities',
  '*.entity{.ts,.js}',
);

describeLive('OneTimeTokenStore on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let store: OneTimeTokenStore;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_one_time_token',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option, 20 connections for the concurrent calls
      // (contract issue 15)
      extra: dialect === 'postgres' ? { max: 20 } : { connectionLimit: 20 },
    });
    dataSource = live.dataSource;
    store = new OneTimeTokenStore(dataSource);
  });

  afterAll(async () => {
    await live?.drop();
  });

  async function createUser(): Promise<string> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        id: randomUUID(),
        email: `one-time-token-${randomUUID()}@example.test`,
        firstName: 'One',
        lastName: 'Time',
        picture: '',
      } as Partial<User>),
    );
    return user.id;
  }

  /** The user's password_reset rows as stored. */
  async function resetRowsOf(userId: string) {
    const db = dialectApi(live.dialect);
    const { rows } = await run(
      dataSource,
      db.sql`SELECT ${db.ident('id')}, ${db.ident('purpose')}, ${db.ident('consumed_at')} AS ${db.ident('consumedAt')},
        ${db.ident('attempts')}, ${db.ident('expires_at')} AS ${db.ident('expiresAt')}, ${db.ident('created_at')} AS ${db.ident('createdAt')}
        FROM ${db.ident('auth_one_time_token')} WHERE ${db.ident('user_id')} = ${userId}`,
    );
    return rows as unknown as {
      id: string;
      purpose: string;
      consumedAt: Date | null;
      attempts: number;
      expiresAt: Date;
      createdAt: Date;
    }[];
  }

  const T = new Date('2026-11-03T10:00:00.000Z');
  const at = (ms: number) => new Date(T.getTime() + ms);

  it('allows 3 reset tokens per user per hour under concurrency', async () => {
    const userId = await createUser();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => store.createPasswordReset(userId, T)),
    );

    const tokens = results.filter((r): r is string => r !== null);
    expect(tokens).toHaveLength(RESET_LIMIT_PER_HOUR);
    expect(results.filter((r) => r === null)).toHaveLength(3);
    // distinct tokens
    expect(new Set(tokens).size).toBe(RESET_LIMIT_PER_HOUR);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rows = await resetRowsOf(userId);
    expect(rows).toHaveLength(RESET_LIMIT_PER_HOUR);
    for (const row of rows) {
      expect(row.purpose).toBe('password_reset');
      expect(row.consumedAt).toBeNull();
      expect(row.expiresAt.getTime()).toBe(T.getTime() + RESET_TTL_MS);
      expect(row.createdAt.getTime()).toBe(T.getTime());
    }
  });

  it('counts only the last hour: an older row does not count against the limit', async () => {
    const userId = await createUser();
    // three tokens now
    for (let i = 0; i < RESET_LIMIT_PER_HOUR; i += 1) {
      await expect(
        store.createPasswordReset(userId, T),
      ).resolves.not.toBeNull();
    }
    await expect(store.createPasswordReset(userId, T)).resolves.toBeNull();
    // one hour and one second later the window is empty again
    await expect(
      store.createPasswordReset(userId, at(3_600_000 + 1)),
    ).resolves.not.toBeNull();
  });

  it('consumes a reset token once under 10 concurrent resets', async () => {
    const userId = await createUser();
    const token = await store.createPasswordReset(userId, T);
    expect(token).not.toBeNull();

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.consumePasswordReset(token as string, T),
      ),
    );

    const consumed = outcomes.filter((o): o is string => o !== null);
    expect(consumed).toHaveLength(1);
    expect(consumed[0]).toBe(userId);

    const rows = await resetRowsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].consumedAt?.getTime()).toBe(T.getTime());
    // only the winner incremented the counter
    expect(Number(rows[0].attempts)).toBe(1);
  });

  it('refuses an already consumed or expired token', async () => {
    const userId = await createUser();
    const token = (await store.createPasswordReset(userId, T)) as string;
    await expect(store.consumePasswordReset(token, T)).resolves.toBe(userId);
    // used: consumed_at is set
    await expect(
      store.consumePasswordReset(token, at(1_000)),
    ).resolves.toBeNull();

    const second = (await store.createPasswordReset(userId, T)) as string;
    // expired: 30 min + 1 ms later
    await expect(
      store.consumePasswordReset(second, at(RESET_TTL_MS + 1)),
    ).resolves.toBeNull();
    // an unknown token
    await expect(
      store.consumePasswordReset('an-unknown-token', T),
    ).resolves.toBeNull();
  });

  it('counts per requester: a stranger who used up their share leaves the user theirs', async () => {
    const userId = await createUser();
    // two requester keys as the keyer gives them (HMAC-SHA256, hex)
    const stranger = '1'.repeat(64);
    const owner = '2'.repeat(64);

    const strangers = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.createPasswordReset(userId, T, { requesterKey: stranger }),
      ),
    );
    expect(strangers.filter((r) => r !== null)).toHaveLength(
      RESET_LIMIT_PER_HOUR,
    );

    // the user's own requests still get through, up to their own 3
    for (let i = 0; i < RESET_LIMIT_PER_HOUR; i += 1) {
      await expect(
        store.createPasswordReset(userId, T, { requesterKey: owner }),
      ).resolves.not.toBeNull();
    }
    await expect(
      store.createPasswordReset(userId, T, { requesterKey: owner }),
    ).resolves.toBeNull();
    expect(await resetRowsOf(userId)).toHaveLength(2 * RESET_LIMIT_PER_HOUR);
  });

  it("a successful reset closes the user's other open links, and no other user's", async () => {
    const userId = await createUser();
    const otherUser = await createUser();
    const used = (await store.createPasswordReset(userId, T)) as string;
    const second = (await store.createPasswordReset(userId, T)) as string;
    const third = (await store.createPasswordReset(userId, T)) as string;
    const foreign = (await store.createPasswordReset(otherUser, T)) as string;

    await expect(store.consumePasswordReset(used, T)).resolves.toBe(userId);
    await expect(
      store.expireOpenPasswordResets(userId, at(1_000)),
    ).resolves.toBe(2);

    await expect(
      store.consumePasswordReset(second, at(2_000)),
    ).resolves.toBeNull();
    await expect(
      store.consumePasswordReset(third, at(2_000)),
    ).resolves.toBeNull();
    await expect(store.consumePasswordReset(foreign, at(2_000))).resolves.toBe(
      otherUser,
    );
    // the used token keeps the time it was consumed at
    const rows = await resetRowsOf(userId);
    expect(rows.map((r) => r.consumedAt?.getTime()).sort()).toEqual(
      [T.getTime(), at(1_000).getTime(), at(1_000).getTime()].sort(),
    );
  });
});
