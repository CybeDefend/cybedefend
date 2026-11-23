import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveDialect,
  liveEnabled,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import { User } from 'src/entities/user.entity';
import { LocalCredential } from './entities/local-credential.entity';
import { LocalCredentialStore } from './local-credential.store';
import { OneTimeTokenStore } from './one-time-token.store';
import { PasswordHasher } from './password-hasher';

/**
 * LIVE spec of the local credential store: the dialect upsert of
 * `set` keeps one row per user on MySQL (the frozen track +
 * migrations-common/) and on PostgreSQL (the baseline + migrations-common/),
 * `changePassword` verifies the current password and writes the new hash in
 * one transaction, and `password_changed_at` reads back as the `now` given
 * (UTC on both engines).
 *
 * Skipped unless LOCAL_AUTH_LIVE=1. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=local-credential.store.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=local-credential.store.live
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

describeLive('LocalCredentialStore on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;
  let hasher: PasswordHasher;
  let store: LocalCredentialStore;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_local_credential',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option (contract issue 15)
      extra: dialect === 'postgres' ? { max: 5 } : { connectionLimit: 5 },
    });
    dataSource = live.dataSource;
    hasher = new PasswordHasher();
    store = new LocalCredentialStore(
      dataSource,
      hasher,
      new OneTimeTokenStore(dataSource),
    );
  });

  afterAll(async () => {
    await live?.drop();
  });

  async function createUser(): Promise<string> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        id: randomUUID(),
        email: `local-credential-${randomUUID()}@example.test`,
        firstName: 'Local',
        lastName: 'Credential',
        picture: '',
      } as Partial<User>),
    );
    return user.id;
  }

  async function credentialRow(userId: string) {
    return dataSource.getRepository(LocalCredential).findOneBy({ userId });
  }

  it('set twice keeps one row with the second hash', async () => {
    const userId = await createUser();
    const first = new Date('2026-11-03T10:00:00.123Z');
    const second = new Date('2026-11-03T11:00:00.456Z');

    await dataSource.transaction((manager) =>
      store.set(manager, userId, 'first-hash', first),
    );
    await dataSource.transaction((manager) =>
      store.set(manager, userId, 'second-hash', second),
    );

    expect(
      await dataSource.getRepository(LocalCredential).countBy({ userId }),
    ).toBe(1);
    await expect(store.hashOf(userId)).resolves.toBe('second-hash');
    // UTC on both engines: the instant reads back unchanged.
    expect((await credentialRow(userId))?.passwordChangedAt.getTime()).toBe(
      second.getTime(),
    );
  });

  it('changes the password in one transaction', async () => {
    const userId = await createUser();
    const now = new Date('2026-11-03T12:00:00.789Z');
    const oldPassword = 'the old password 1';
    const newPassword = 'the new password 2';
    const currentHash = await hasher.hash(oldPassword);
    await dataSource.transaction((manager) =>
      store.set(manager, userId, currentHash, now),
    );

    await store.changePassword(userId, oldPassword, newPassword, now);

    const row = await credentialRow(userId);
    expect(row?.passwordChangedAt.getTime()).toBe(now.getTime());
    const newHash = await store.hashOf(userId);
    expect(newHash).not.toBe(currentHash);
    expect(newHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify(newHash, newPassword)).resolves.toBe(true);
    await expect(hasher.verify(newHash, oldPassword)).resolves.toBe(false);

    // A wrong current password changes nothing.
    const thrown = await store
      .changePassword(userId, 'not the password', 'another password 3', now)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'CURRENT_PASSWORD_INVALID',
    });
    await expect(store.hashOf(userId)).resolves.toBe(newHash);
  });

  it("a password change closes the user's open reset links, and a wrong one does not", async () => {
    const userId = await createUser();
    const tokens = new OneTimeTokenStore(dataSource);
    const now = new Date('2026-11-03T13:00:00.000Z');
    const later = new Date('2026-11-03T13:01:00.000Z');
    await dataSource.transaction(async (manager) =>
      store.set(manager, userId, await hasher.hash('the old password 1'), now),
    );
    const kept = (await tokens.createPasswordReset(userId, now)) as string;
    const closed = (await tokens.createPasswordReset(userId, now)) as string;

    // a refused change leaves the links open
    await expect(
      store.changePassword(
        userId,
        'not the password',
        'the new password 2',
        now,
      ),
    ).rejects.toBeInstanceOf(RpcException);
    await expect(tokens.consumePasswordReset(kept, now)).resolves.toBe(userId);

    await store.changePassword(
      userId,
      'the old password 1',
      'the new password 2',
      now,
    );
    await expect(
      tokens.consumePasswordReset(closed, later),
    ).resolves.toBeNull();
  });
});
