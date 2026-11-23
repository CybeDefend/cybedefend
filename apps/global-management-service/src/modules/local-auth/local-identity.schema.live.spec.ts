import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import {
  createLiveDatabase,
  liveDialect,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import { User } from 'src/entities/user.entity';
import { AuthOneTimeToken } from './entities/auth-one-time-token.entity';
import { AuthRefreshToken } from './entities/auth-refresh-token.entity';
import { AuthSigningKey } from './entities/auth-signing-key.entity';
import { LocalCredential } from './entities/local-credential.entity';
import { LocalPersonalAccessTokenEntity } from './entities/personal-access-token.entity';

/**
 * LIVE spec of the local identity tables: the common migration
 * 1786300000000-CreateLocalIdentityTables must create the same five tables on
 * MySQL (the frozen track + migrations-common/) and on PostgreSQL (the
 * baseline + migrations-common/), the FKs must delete a user's credentials,
 * tokens and PATs with the user row, and the unique index on
 * (user_id, active_name) must refuse a second active token of one name and
 * free the name once the first is revoked.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=local-identity.schema.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=local-identity.schema.live
 */
const LIVE = process.env.LOCAL_AUTH_LIVE === '1';
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

const TABLES = [
  'local_credential',
  'auth_refresh_token',
  'auth_one_time_token',
  'personal_access_token',
  'auth_signing_key',
];
describeLive('local identity schema on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_local_identity',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option (contract issue 15)
      extra: dialect === 'postgres' ? { max: 5 } : { connectionLimit: 5 },
    });
    dataSource = live.dataSource;
  });

  afterAll(async () => {
    await live?.drop();
  });

  async function createUser(): Promise<string> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        id: randomUUID(),
        email: `local-auth-${randomUUID()}@example.test`,
        firstName: 'Local',
        lastName: 'Auth',
        picture: '',
      } as Partial<User>),
    );
    return user.id;
  }

  const hash = () => randomBytes(32).toString('hex');

  it('creates the five tables', async () => {
    for (const table of TABLES) {
      // A SELECT against the table: on a missing table the engine itself
      // answers (Table … doesn't exist / relation … does not exist).
      const row = (await dataSource
        .createQueryBuilder()
        .from(table, 't')
        .select('COUNT(*)', 'n')
        .getRawOne()) as { n: number | string };
      expect(Number(row.n)).toBe(0);
    }
    const runner = dataSource.createQueryRunner();
    try {
      const pat = await runner.getTable('personal_access_token');
      expect(pat?.findColumnByName('active_name')).toBeDefined();
      const aott = await runner.getTable('auth_one_time_token');
      expect(aott?.findColumnByName('purpose')?.enum).toEqual([
        'password_reset',
        'setup',
      ]);
    } finally {
      await runner.release();
    }
  });

  it("deletes a user's credentials, tokens and PATs with the user (FK cascade)", async () => {
    const userId = await createUser();
    await dataSource.getRepository(LocalCredential).insert({
      userId,
      passwordHash: hash(),
      passwordChangedAt: new Date(),
    });
    await dataSource.getRepository(AuthRefreshToken).insert({
      id: randomUUID(),
      userId,
      familyId: randomUUID(),
      tokenHash: hash(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await dataSource.getRepository(AuthOneTimeToken).insert({
      id: randomUUID(),
      userId,
      purpose: 'setup',
      tokenHash: hash(),
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });
    await dataSource.getRepository(LocalPersonalAccessTokenEntity).insert({
      id: randomUUID(),
      userId,
      name: 'ci',
      tokenHash: hash(),
      lastFour: 'wxyz',
    });
    await dataSource.getRepository(AuthSigningKey).insert({
      kid: `kid-${randomUUID()}`,
      privateKeyEncrypted: 'encrypted',
      publicJwk: '{}',
    });

    await dataSource.getRepository(User).delete(userId);

    expect(
      await dataSource.getRepository(LocalCredential).countBy({ userId }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(AuthRefreshToken).countBy({ userId }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(AuthOneTimeToken).countBy({ userId }),
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(LocalPersonalAccessTokenEntity)
        .countBy({ userId }),
    ).toBe(0);
    // The signing key is instance-level, not keyed by the user: it stays.
    expect(await dataSource.getRepository(AuthSigningKey).count()).toBe(1);
  });

  it('refuses two active tokens of one name for one user, allows it once revoked', async () => {
    const userId = await createUser();
    const repo = dataSource.getRepository(LocalPersonalAccessTokenEntity);
    const insert = () =>
      repo.insert({
        id: randomUUID(),
        userId,
        name: 'ci',
        tokenHash: hash(),
        lastFour: 'wxyz',
      });

    await insert();
    let error: unknown;
    try {
      await insert();
    } catch (e) {
      error = e;
    }
    expect(isUniqueViolation(error)).toBe(true);

    // revoked_at set to now through the query builder frees the name:
    // active_name is NULL for a revoked token, and both engines allow
    // several NULLs in the unique index.
    await dataSource
      .createQueryBuilder()
      .update(LocalPersonalAccessTokenEntity)
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .execute();

    await insert();
    expect(await repo.countBy({ userId })).toBe(2);
  });
});
