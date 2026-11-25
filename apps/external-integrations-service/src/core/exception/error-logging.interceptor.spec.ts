import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { lastValueFrom, throwError } from 'rxjs';
import type { Logger } from 'nestjs-pino';
import { ErrorLoggingInterceptor } from './error-logging.interceptor';

/**
 * The global interceptor logs an unexpected error of a call. It names the
 * call (its method, route pattern or handler, the status the caller gets and
 * the caller's id) and the error through the shared serializer: never the
 * request's data, its query values or its headers / gRPC metadata, and never
 * the statement, parameters or quoted values of a database error, which can
 * carry a password hash, a token digest, an e-mail address or a user's text.
 */

const ARGON = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';
const DIGEST = 'a'.repeat(64);
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'jane.doe+private@example.test';
const JWT = 'Bearer secret-jwt';

/** TypeORM's QueryFailedError: statement, parameters, driver error, and a copy of its fields. */
function queryFailed(
  query: string,
  parameters: unknown[],
  driverError: Error,
): Error {
  const err = new Error(driverError.message);
  Object.defineProperty(err, 'name', { value: 'QueryFailedError' });
  const { name: _name, ...fields } = driverError as unknown as Record<
    string,
    unknown
  >;
  void _name;
  return Object.assign(err, fields, { query, parameters, driverError });
}

/** gRPC metadata as Nest hands it to an RPC handler. */
function metadataOf(values: Record<string, string>) {
  return {
    get: (key: string) => (key in values ? [values[key]] : []),
    getMap: () => values,
  };
}

function rpcContext(data: unknown): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getContext: () =>
        metadataOf({
          authorization: JWT,
          'x-cybedefend-service': 'gateway',
          'x-user-email': EMAIL,
        }),
      getData: () => data,
    }),
    getClass: () => ({ name: 'LocalAuthController' }),
    getHandler: () => ({ name: 'setupInstance' }),
  } as unknown as ExecutionContext;
}

function httpContext(): ExecutionContext {
  const request = {
    method: 'POST',
    url: `/projects/p1/members?email=${encodeURIComponent(EMAIL)}`,
    routeOptions: { url: '/projects/:projectId/members' },
    query: { email: EMAIL },
    body: { password: PASSWORD, email: EMAIL },
    headers: { authorization: JWT, cookie: `session=${DIGEST}` },
    user: { userId: 'user-42', accessToken: 'secret-jwt' },
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => ({ name: 'MembersController' }),
    getHandler: () => ({ name: 'addMember' }),
  } as unknown as ExecutionContext;
}

async function logOf(err: unknown, context: ExecutionContext): Promise<string> {
  const error = jest.fn();
  const interceptor = new ErrorLoggingInterceptor({
    error,
  } as unknown as Logger);
  const next: CallHandler = { handle: () => throwError(() => err) };
  await expect(
    lastValueFrom(interceptor.intercept(context, next)),
  ).rejects.toBe(err);
  return error.mock.calls.map((c) => JSON.stringify(c)).join('\n');
}

describe('ErrorLoggingInterceptor', () => {
  it('logs a MySQL duplicate entry by class, code and key, never the value, the statement or the request', async () => {
    const message = `Duplicate entry '${DIGEST}' for key 'auth_refresh_token.IDX_token_hash'`;
    const driverError = Object.assign(new Error(message), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlState: '23000',
      sqlMessage: message,
      sql: `INSERT INTO local_credential VALUES ('u1', '${ARGON}')`,
    });
    const err = queryFailed(
      'INSERT INTO local_credential (user_id, password_hash) VALUES (?, ?)',
      ['u1', ARGON, DIGEST],
      driverError,
    );

    const line = await logOf(
      err,
      rpcContext({ password: PASSWORD, token: DIGEST }),
    );

    expect(line).toContain('QueryFailedError');
    expect(line).toContain('ER_DUP_ENTRY');
    expect(line).toContain('auth_refresh_token.IDX_token_hash');
    expect(line).toContain('LocalAuthController.setupInstance');
    expect(line).toContain('gateway');
    expect(line).toContain("Duplicate entry '[redacted]'");
    expect(line).not.toContain(ARGON);
    expect(line).not.toContain(DIGEST);
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain('password_hash');
    expect(line).not.toContain('secret-jwt');
    expect(line).not.toContain(EMAIL);
  });

  it('logs a PostgreSQL unique violation by code and constraint, never its detail', async () => {
    const driverError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "UQ_aott_token_hash"',
      ),
      {
        code: '23505',
        detail: `Key (token_hash)=(${DIGEST}) already exists.`,
        constraint: 'UQ_aott_token_hash',
        table: 'auth_one_time_token',
        severity: 'ERROR',
      },
    );
    const err = queryFailed(
      'INSERT INTO "auth_one_time_token" VALUES ($1, $2)',
      ['id', DIGEST],
      driverError,
    );

    const line = await logOf(err, rpcContext({}));

    expect(line).toContain('23505');
    expect(line).toContain('UQ_aott_token_hash');
    expect(line).toContain('auth_one_time_token');
    expect(line).not.toContain(DIGEST);
    expect(line).not.toContain('already exists');
    expect(line).not.toContain('INSERT INTO');
  });

  it('logs a bare driver error (no wrapper) the same way', async () => {
    const err = Object.assign(new Error(`Duplicate entry '${DIGEST}'`), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
      sqlMessage: `Duplicate entry '${DIGEST}'`,
    });

    const line = await logOf(err, rpcContext({}));

    expect(line).toContain('ER_DUP_ENTRY');
    expect(line).not.toContain(DIGEST);
  });

  it('keeps the message and stack of an ordinary error, without the request data or metadata', async () => {
    const err = new TypeError('cannot read properties of undefined');

    const line = await logOf(err, rpcContext({ password: PASSWORD }));

    expect(line).toContain('TypeError');
    expect(line).toContain('cannot read properties of undefined');
    expect(line).toContain('error-logging.interceptor.spec');
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain('secret-jwt');
    expect(line).not.toContain(EMAIL);
  });

  it('logs an HTTP call by method, route pattern, status and user id, never its body, query values or headers', async () => {
    const line = await logOf(new Error('store unavailable'), httpContext());

    expect(line).toContain('POST');
    expect(line).toContain('/projects/:projectId/members');
    expect(line).toContain('500');
    expect(line).toContain('user-42');
    expect(line).toContain('store unavailable');
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain(encodeURIComponent(EMAIL));
    expect(line).not.toContain(DIGEST);
    expect(line).not.toContain('secret-jwt');
  });

  it.each([
    ['an RpcException', new RpcException('INVALID_CREDENTIALS')],
    ['an HttpException', new BadRequestException('bad input')],
  ])('does not log %s and rethrows it', async (_name, err) => {
    const error = jest.fn();
    const interceptor = new ErrorLoggingInterceptor({
      error,
    } as unknown as Logger);
    await expect(
      lastValueFrom(
        interceptor.intercept(rpcContext({}), {
          handle: () => throwError(() => err),
        }),
      ),
    ).rejects.toBe(err);
    expect(error).not.toHaveBeenCalled();
  });
});
