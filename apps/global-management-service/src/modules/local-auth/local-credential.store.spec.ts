import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { upsert } from '@cybedefend/db-dialect';
import {
  createSqlCaptureDataSource,
  type CapturedStatement,
} from 'src/test-utils/sql-capture.util';
import { LocalCredentialStore } from './local-credential.store';
import type { OneTimeTokenStore } from './one-time-token.store';
import { PasswordHasher } from './password-hasher';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-03T10:00:00.123Z');
const CURRENT_PASSWORD = 'the right current password';
const NEW_PASSWORD = 'a brand new password';

const isSelect = (s: CapturedStatement) => /^\s*SELECT/i.test(s.sql);
const isInsert = (s: CapturedStatement) => /^\s*INSERT/i.test(s.sql);

/** The one-time token store, as the credential store sees it. */
function resetLinks() {
  return { expireOpenPasswordResets: jest.fn(async () => 0) };
}
const asTokens = (t: ReturnType<typeof resetLinks>) =>
  t as unknown as OneTimeTokenStore;

/**
 * The capture data source's query runner made transaction-capable, so
 * `dataSource.transaction(...)` runs its callback with a manager whose
 * `queryRunner` is the capturing runner.
 */
function transactionCapable(dataSource: DataSource): void {
  const runner = (
    dataSource as unknown as { createQueryRunner: () => QueryRunner }
  ).createQueryRunner();
  runner.startTransaction = async () => undefined;
  runner.commitTransaction = async () => undefined;
  runner.rollbackTransaction = async () => undefined;
  (runner as unknown as { manager: EntityManager }).manager = {
    queryRunner: runner,
  } as unknown as EntityManager;
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: number; message: string }> {
  const thrown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(RpcException);
  return (thrown as RpcException).getError() as {
    code: number;
    message: string;
  };
}

describe('LocalCredentialStore.set', () => {
  it('writes the credential with the dialect upsert', async () => {
    const { dataSource, statements } = await createSqlCaptureDataSource();
    const store = new LocalCredentialStore(
      dataSource,
      new PasswordHasher(),
      asTokens(resetLinks()),
    );
    const runner = (
      dataSource as unknown as { createQueryRunner: () => QueryRunner }
    ).createQueryRunner();
    const manager = { queryRunner: runner } as unknown as EntityManager;

    const hash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
    await store.set(manager, USER_ID, hash, NOW);

    // No MySQL or PostgreSQL text of its own: the expected statement is the
    // one the dialect library builds for the current dialect (libs/db-dialect's
    // unit tests own both renderings).
    const expected = upsert(
      'local_credential',
      { user_id: USER_ID, password_hash: hash, password_changed_at: NOW },
      {
        conflict: ['user_id'],
        update: {
          password_hash: 'excluded',
          password_changed_at: 'excluded',
        },
      },
    );
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toBe(expected.text);
    expect(statements[0].params).toEqual([USER_ID, hash, NOW]);
  });
});

describe('LocalCredentialStore.changePassword', () => {
  async function storeWithStoredHash(storedHash: string | null) {
    const hasher = new PasswordHasher();
    const { dataSource, statements } = await createSqlCaptureDataSource((s) =>
      isSelect(s)
        ? storedHash === null
          ? []
          : [{ password_hash: storedHash }]
        : { affected: 1 },
    );
    transactionCapable(dataSource);
    const tokens = resetLinks();
    return {
      hasher,
      statements,
      tokens,
      store: new LocalCredentialStore(dataSource, hasher, asTokens(tokens)),
    };
  }

  it('refuses a wrong current password with CURRENT_PASSWORD_INVALID and writes nothing', async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store, statements } = await storeWithStoredHash(currentHash);

    await expect(
      refusalOf(
        store.changePassword(USER_ID, 'a wrong password', NEW_PASSWORD, NOW),
      ),
    ).resolves.toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'CURRENT_PASSWORD_INVALID',
    });
    expect(statements.filter(isInsert)).toHaveLength(0);
  });

  it('refuses a user without a credential with CURRENT_PASSWORD_INVALID, never INVALID_CREDENTIALS', async () => {
    const { store, statements } = await storeWithStoredHash(null);

    await expect(
      refusalOf(
        store.changePassword(USER_ID, CURRENT_PASSWORD, NEW_PASSWORD, NOW),
      ),
    ).resolves.toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'CURRENT_PASSWORD_INVALID',
    });
    expect(statements.filter(isInsert)).toHaveLength(0);
  });

  it('refuses a new password outside the policy with PASSWORD_POLICY and writes nothing', async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store, statements } = await storeWithStoredHash(currentHash);

    await expect(
      refusalOf(store.changePassword(USER_ID, CURRENT_PASSWORD, 'short', NOW)),
    ).resolves.toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'PASSWORD_POLICY',
    });
    expect(statements.filter(isInsert)).toHaveLength(0);
  });

  it('stores the new hash for the right current password, in one transaction', async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store, statements } = await storeWithStoredHash(currentHash);

    await store.changePassword(USER_ID, CURRENT_PASSWORD, NEW_PASSWORD, NOW);

    const inserts = statements.filter(isInsert);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[0]).toBe(USER_ID);
    expect(inserts[0].params[2]).toEqual(NOW);
    const newHash = inserts[0].params[1] as string;
    expect(newHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(newHash).not.toBe(currentHash);
    await expect(hasher.verify(newHash, NEW_PASSWORD)).resolves.toBe(true);
    await expect(hasher.verify(newHash, CURRENT_PASSWORD)).resolves.toBe(false);
  });

  it("expires the user's open password-reset links in the transaction that writes the new hash", async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store, statements, tokens } =
      await storeWithStoredHash(currentHash);

    await store.changePassword(USER_ID, CURRENT_PASSWORD, NEW_PASSWORD, NOW);

    expect(tokens.expireOpenPasswordResets).toHaveBeenCalledTimes(1);
    const [userId, at, manager] = tokens.expireOpenPasswordResets.mock
      .calls[0] as unknown as [string, Date, EntityManager];
    expect(userId).toBe(USER_ID);
    expect(at).toEqual(NOW);
    // the transaction's manager, the one the new hash was written with
    expect(manager).toBeDefined();
    expect(manager.queryRunner).toBeDefined();
    expect(statements.filter(isInsert)).toHaveLength(1);
  });

  it("runs the caller's revocations in the transaction that writes the new hash", async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store, tokens } = await storeWithStoredHash(currentHash);
    const alsoInTransaction = jest.fn(async () => undefined);

    await store.changePassword(
      USER_ID,
      CURRENT_PASSWORD,
      NEW_PASSWORD,
      NOW,
      alsoInTransaction,
    );

    expect(alsoInTransaction).toHaveBeenCalledTimes(1);
    const [manager] = alsoInTransaction.mock.calls[0] as unknown as [
      EntityManager,
    ];
    const [, , resetManager] = tokens.expireOpenPasswordResets.mock
      .calls[0] as unknown as [string, Date, EntityManager];
    expect(manager).toBe(resetManager);
  });

  it('runs no revocation when the current password is wrong', async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store } = await storeWithStoredHash(currentHash);
    const alsoInTransaction = jest.fn(async () => undefined);

    await expect(
      store.changePassword(
        USER_ID,
        'a wrong password',
        NEW_PASSWORD,
        NOW,
        alsoInTransaction,
      ),
    ).rejects.toBeInstanceOf(RpcException);
    expect(alsoInTransaction).not.toHaveBeenCalled();
  });

  it('assertCurrentPassword accepts the right password and refuses a wrong or missing one', async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store } = await storeWithStoredHash(currentHash);
    // It answers the hash it verified.
    await expect(
      store.assertCurrentPassword(USER_ID, CURRENT_PASSWORD),
    ).resolves.toBe(currentHash);
    for (const wrong of ['a wrong password', '']) {
      await expect(
        refusalOf(store.assertCurrentPassword(USER_ID, wrong)),
      ).resolves.toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'CURRENT_PASSWORD_INVALID',
      });
    }
    const none = await storeWithStoredHash(null);
    await expect(
      refusalOf(none.store.assertCurrentPassword(USER_ID, CURRENT_PASSWORD)),
    ).resolves.toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'CURRENT_PASSWORD_INVALID',
    });
  });

  it('expires no reset link when the current password is wrong', async () => {
    const hasher = new PasswordHasher();
    const currentHash = await hasher.hash(CURRENT_PASSWORD);
    const { store, tokens } = await storeWithStoredHash(currentHash);

    await expect(
      store.changePassword(USER_ID, 'a wrong password', NEW_PASSWORD, NOW),
    ).rejects.toBeInstanceOf(RpcException);
    expect(tokens.expireOpenPasswordResets).not.toHaveBeenCalled();
  });
});
