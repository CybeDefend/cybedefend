import 'reflect-metadata';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { DataSource, EntityManager } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { User } from 'src/entities/user.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { LocalAccountService, splitName } from './local-account.service';
import { LocalCredentialStore } from './local-credential.store';
import { PasswordHasher } from './password-hasher';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: status; message: string }> {
  const thrown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(RpcException);
  return (thrown as RpcException).getError() as {
    code: status;
    message: string;
  };
}

describe('LocalAccountService', () => {
  let manager: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let hasher: { hash: jest.Mock };
  let credentials: { set: jest.Mock };
  let mail: { sendWelcomeEmail: jest.Mock };
  let logger: ReturnType<typeof createLoggerMock>;
  let service: LocalAccountService;

  beforeEach(() => {
    manager = {
      create: jest.fn((_entity: unknown, plain: unknown) => ({
        ...(plain as Record<string, unknown>),
        id: USER_ID,
      })),
      save: jest.fn(async (entity: unknown) => entity),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) =>
        cb(manager as unknown as EntityManager),
      ),
    };
    hasher = { hash: jest.fn(async () => HASH) };
    credentials = { set: jest.fn(async () => undefined) };
    mail = { sendWelcomeEmail: jest.fn(async () => undefined) };
    logger = createLoggerMock();
    service = new LocalAccountService(
      dataSource as unknown as DataSource,
      hasher as unknown as PasswordHasher,
      credentials as unknown as LocalCredentialStore,
      mail as unknown as MailService,
      logger as unknown as Logger,
    );
  });

  it('never splits the name: one string becomes firstName with lastName empty', () => {
    expect(splitName('Ada Lovelace')).toEqual({
      firstName: 'Ada Lovelace',
      lastName: '',
    });
    expect(splitName('  Ada Lovelace  ')).toEqual({
      firstName: 'Ada Lovelace',
      lastName: '',
    });
    expect(splitName('Grace Hopper')).toEqual({
      firstName: 'Grace Hopper',
      lastName: '',
    });
  });

  it('stores the e-mail lower-cased and trimmed, the name unsplit, and the credential in one transaction', async () => {
    const user = await service.createAccount(
      {
        email: '  Admin@Example.TEST ',
        password: 'the password 1',
        name: ' Ada Lovelace ',
      },
      NOW,
    );
    // The user row is the transaction's first statement, the credential the
    // second one.
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.create).toHaveBeenCalledWith(
      User,
      expect.objectContaining({
        email: 'admin@example.test',
        firstName: 'Ada Lovelace',
        lastName: '',
      }),
    );
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(credentials.set).toHaveBeenCalledWith(manager, USER_ID, HASH, NOW);
    expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
      credentials.set.mock.invocationCallOrder[0],
    );
    expect(user.id).toBe(USER_ID);
    expect(user.email).toBe('admin@example.test');
    // The welcome mail goes to the stored address, after the commit.
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith(
      'admin@example.test',
      'Ada Lovelace',
    );
  });

  it('maps a duplicate e-mail to ACCOUNT_EXISTS', async () => {
    const duplicate = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    dataSource.transaction.mockRejectedValueOnce(duplicate);
    const refusal = await refusalOf(
      service.createAccount(
        {
          email: 'admin@example.test',
          password: 'the password 1',
          name: 'Ada',
        },
        NOW,
      ),
    );
    expect(refusal).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'ACCOUNT_EXISTS',
    });
    // The transaction was rolled back: no welcome mail.
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('maps a PostgreSQL unique violation to ACCOUNT_EXISTS too', async () => {
    const duplicate = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    dataSource.transaction.mockRejectedValueOnce(duplicate);
    const refusal = await refusalOf(
      service.createAccount(
        {
          email: 'admin@example.test',
          password: 'the password 1',
          name: 'Ada',
        },
        NOW,
      ),
    );
    expect(refusal).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'ACCOUNT_EXISTS',
    });
  });

  it('rethrows any other database error', async () => {
    const boom = new Error('connection lost');
    dataSource.transaction.mockRejectedValueOnce(boom);
    const thrown = await service
      .createAccount(
        {
          email: 'admin@example.test',
          password: 'the password 1',
          name: 'Ada',
        },
        NOW,
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(thrown).toBe(boom);
  });

  it('does not fail on a welcome mail failure, and never logs the address', async () => {
    mail.sendWelcomeEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const user = await service.createAccount(
      { email: 'admin@example.test', password: 'the password 1', name: 'Ada' },
      NOW,
    );
    expect(user.id).toBe(USER_ID);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const logged = [logger.error, logger.warn, logger.log, logger.debug]
      .flatMap((m) => m.mock.calls)
      .flat()
      .map(String);
    expect(logged.some((line) => line.includes('admin@example.test'))).toBe(
      false,
    );
    expect(logged.some((line) => line.includes('LocalAccountService'))).toBe(
      true,
    );
  });
});
