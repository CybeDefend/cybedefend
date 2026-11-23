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
  REFRESH_FAMILY_TTL_MS,
  REFRESH_RACE_WINDOW_MS,
  RefreshTokenStore,
} from './refresh-token.store';

/**
 * LIVE spec of the refresh token store against a REAL MySQL or
 * PostgreSQL, built by the real migrations of global-management (both engines).
 * The unit spec pins the statements; only the real
 * engines prove what they do under concurrency: ten parallel refreshes on one
 * token let exactly one rotate, the others answer race inside the 20 s window,
 * and a reuse 20 s or more after the rotation revokes the whole family.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1, so `pnpm run test` stays hermetic. The
 * engine is LIVE_DB_TYPE (mysql by default). It creates a throwaway database
 * and drops it at the end. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=refresh-token.store.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=refresh-token.store.live
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

describeLive('RefreshTokenStore on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let store: RefreshTokenStore;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_refresh_token',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option, 20 connections for the 10 concurrent
      // refreshes (contract issue 15)
      extra: dialect === 'postgres' ? { max: 20 } : { connectionLimit: 20 },
    });
    dataSource = live.dataSource;
    store = new RefreshTokenStore(dataSource);
  });

  afterAll(async () => {
    await live?.drop();
  });

  async function createUser(): Promise<string> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        id: randomUUID(),
        email: `refresh-token-${randomUUID()}@example.test`,
        firstName: 'Refresh',
        lastName: 'Token',
        picture: '',
      } as Partial<User>),
    );
    return user.id;
  }

  /** The user's refresh-token rows as stored. */
  async function rowsOf(userId: string) {
    const db = dialectApi(live.dialect);
    const { rows } = await run(
      dataSource,
      db.sql`SELECT ${db.ident('id')}, ${db.ident('family_id')} AS ${db.ident('familyId')},
        ${db.ident('rotated_at')} AS ${db.ident('rotatedAt')}, ${db.ident('revoked_at')} AS ${db.ident('revokedAt')}
        FROM ${db.ident('auth_refresh_token')} WHERE ${db.ident('user_id')} = ${userId}`,
    );
    return rows as unknown as {
      id: string;
      familyId: string;
      rotatedAt: Date | null;
      revokedAt: Date | null;
    }[];
  }

  const T = new Date('2026-11-03T10:00:00.000Z');
  const at = (ms: number) => new Date(T.getTime() + ms);

  it('rotates a token once under 10 concurrent refreshes', async () => {
    const userId = await createUser();
    const { token } = await store.issue(userId, T);

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => store.rotate(token, T)),
    );

    const kinds = outcomes.map((o) => o.kind);
    expect(kinds.filter((k) => k === 'rotated')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'race')).toHaveLength(9);
    // the family has exactly two rows (the issued token and its
    // replacement) and none is revoked
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt === null)).toBe(true);
  });

  it('answers race within 20 s and revokes nothing', async () => {
    const userId = await createUser();
    const { token } = await store.issue(userId, T);
    await store.rotate(token, T);

    const late = await store.rotate(
      token,
      at(REFRESH_RACE_WINDOW_MS - 1), // 19,999 ms after the rotation
    );

    expect(late.kind).toBe('race');
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt === null)).toBe(true);
  });

  it('revokes the whole family on a reuse 20 s after rotation', async () => {
    const userId = await createUser();
    const first = await store.issue(userId, T);
    const r1 = await store.rotate(first.token, T);
    expect(r1.kind).toBe('rotated');
    if (r1.kind !== 'rotated') return;
    const r2 = await store.rotate(r1.token, at(1_000));
    expect(r2.kind).toBe('rotated');
    if (r2.kind !== 'rotated') return;

    // the first token again, exactly 20 s after its rotation
    const reuse = await store.rotate(first.token, at(REFRESH_RACE_WINDOW_MS));

    expect(reuse.kind).toBe('reused');
    if (reuse.kind === 'reused') {
      expect(reuse.userId).toBe(userId);
      expect(reuse.familyId).toEqual(expect.any(String));
    }
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    // the newest token of the family is now invalid, like an unknown one
    await expect(
      store.rotate(r2.token, at(REFRESH_RACE_WINDOW_MS + 1_000)),
    ).resolves.toEqual({ kind: 'invalid' });
  });

  it('refuses an expired family', async () => {
    const userId = await createUser();
    const { token } = await store.issue(userId, T);

    await expect(
      store.rotate(token, at(REFRESH_FAMILY_TTL_MS + 1)),
    ).resolves.toEqual({ kind: 'invalid' });
  });

  it('logout revokes the family', async () => {
    const userId = await createUser();
    const first = await store.issue(userId, T);
    const r1 = await store.rotate(first.token, T);
    expect(r1.kind).toBe('rotated');
    if (r1.kind !== 'rotated') return;

    await store.revokeFamilyOf(r1.token, at(5_000));

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(store.rotate(r1.token, at(6_000))).resolves.toEqual({
      kind: 'invalid',
    });
    // an unknown token is a no-op
    await expect(
      store.revokeFamilyOf('unknown-token-value', T),
    ).resolves.toBeUndefined();
  });

  it('revokeAllOfUser revokes every family of the user', async () => {
    const userId = await createUser();
    const a = await store.issue(userId, T);
    const b = await store.issue(userId, T);

    await store.revokeAllOfUser(userId, at(5_000));

    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(store.rotate(a.token, at(6_000))).resolves.toEqual({
      kind: 'invalid',
    });
    await expect(store.rotate(b.token, at(6_000))).resolves.toEqual({
      kind: 'invalid',
    });
  });
});
