import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { lastValueFrom, throwError } from 'rxjs';
import { QueryFailedError } from 'typeorm';
import type { Logger } from 'nestjs-pino';
import { ErrorLoggingInterceptor } from './error-logging.interceptor';

/**
 * The global interceptor logs an unexpected error of an RPC. A TypeORM
 * QueryFailedError carries the statement, its parameters and the driver error
 * (whose own properties it copies onto itself: mysql2's `sql` with the values
 * inlined, `sqlMessage`, PostgreSQL's `detail`), and a duplicate-key message
 * quotes the duplicated value on both engines. An INSERT of a credential, a
 * refresh token, a reset token or a personal access token would then write an
 * argon2id hash or a token digest into the logs. The interceptor logs a
 * driver error by class, code and constraint only, never its message,
 * parameters, statement or the request.
 */

const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';
const DIGEST = 'a'.repeat(64);
const PASSWORD = 'correct horse battery staple';

function contextWith(data: unknown): ExecutionContext {
  return {
    switchToRpc: () => ({
      getContext: () => ({ authorization: 'Bearer secret-jwt' }),
      getData: () => data,
    }),
    getClass: () => ({ name: 'LocalAuthController' }),
    getHandler: () => ({ name: 'setupInstance' }),
  } as unknown as ExecutionContext;
}

async function logOf(err: unknown, data: unknown = {}): Promise<string> {
  const error = jest.fn();
  const interceptor = new ErrorLoggingInterceptor({
    error,
  } as unknown as Logger);
  const next: CallHandler = { handle: () => throwError(() => err) };
  await expect(
    lastValueFrom(interceptor.intercept(contextWith(data), next)),
  ).rejects.toBe(err);
  return error.mock.calls.map((c) => String(c[0])).join('\n');
}

describe('ErrorLoggingInterceptor', () => {
  it('logs a MySQL duplicate key by class and code, never the hash, the statement or the request', async () => {
    const driverError = Object.assign(
      new Error(
        `Duplicate entry '${DIGEST}' for key 'auth_refresh_token.IDX_token_hash'`,
      ),
      {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
        sqlState: '23000',
        sqlMessage: `Duplicate entry '${DIGEST}' for key 'auth_refresh_token.IDX_token_hash'`,
        sql: `INSERT INTO local_credential VALUES ('u1', '${ARGON}')`,
      },
    );
    const err = new QueryFailedError(
      'INSERT INTO local_credential (user_id, password_hash) VALUES (?, ?)',
      ['u1', ARGON, DIGEST],
      driverError,
    );

    const line = await logOf(err, { password: PASSWORD, token: DIGEST });

    expect(line).toContain('QueryFailedError');
    expect(line).toContain('ER_DUP_ENTRY');
    expect(line).toContain('LocalAuthController.setupInstance');
    expect(line).not.toContain(ARGON);
    expect(line).not.toContain(DIGEST);
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain('password_hash');
    expect(line).not.toContain('Duplicate entry');
    expect(line).not.toContain('secret-jwt');
  });

  it('logs a PostgreSQL unique violation by code and constraint, never its detail or message', async () => {
    const driverError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "UQ_aott_token_hash"',
      ),
      {
        name: 'error',
        code: '23505',
        detail: `Key (token_hash)=(${DIGEST}) already exists.`,
        constraint: 'UQ_aott_token_hash',
        table: 'auth_one_time_token',
        severity: 'ERROR',
      },
    );
    const err = new QueryFailedError(
      'INSERT INTO "auth_one_time_token" VALUES ($1, $2)',
      ['id', DIGEST],
      driverError,
    );

    const line = await logOf(err);

    expect(line).toContain('23505');
    expect(line).toContain('UQ_aott_token_hash');
    expect(line).not.toContain(DIGEST);
    expect(line).not.toContain('already exists');
    expect(line).not.toContain('duplicate key value');
  });

  it('logs a bare driver error (no QueryFailedError wrapper) the same way', async () => {
    const err = Object.assign(new Error(`Duplicate entry '${DIGEST}'`), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlMessage: `Duplicate entry '${DIGEST}'`,
    });

    const line = await logOf(err);

    expect(line).toContain('ER_DUP_ENTRY');
    expect(line).not.toContain(DIGEST);
  });

  it('keeps the message and stack of an ordinary error, without the request data', async () => {
    const err = new TypeError('cannot read properties of undefined');

    const line = await logOf(err, { password: PASSWORD });

    expect(line).toContain('TypeError');
    expect(line).toContain('cannot read properties of undefined');
    expect(line).toContain('error-logging.interceptor.spec');
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain('secret-jwt');
  });

  it('does not log an RpcException and rethrows it', async () => {
    const error = jest.fn();
    const interceptor = new ErrorLoggingInterceptor({
      error,
    } as unknown as Logger);
    const err = new RpcException('INVALID_CREDENTIALS');
    await expect(
      lastValueFrom(
        interceptor.intercept(contextWith({}), {
          handle: () => throwError(() => err),
        }),
      ),
    ).rejects.toBe(err);
    expect(error).not.toHaveBeenCalled();
  });
});
