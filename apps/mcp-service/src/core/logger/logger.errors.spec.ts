import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import Pino from 'pino';
import { Logger as NestLogger } from '@nestjs/common';
import { BaseRpcExceptionFilter } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { Logger as PinoNestLogger, PinoLogger } from 'nestjs-pino';
import { createHttpLoggerOptions, createLoggerOptions } from './logger';

/**
 * Every log line of the service goes through the pino-http instance built
 * from `createHttpLoggerOptions` (nestjs-pino takes its root logger from it,
 * inside a request or not). An error logged in any of the shapes the code and
 * the framework use must come out without the statement, its parameters, the
 * driver's detail or the value an engine's message quotes: under any key, in
 * the line's message when the error is logged alone (pino copies the raw
 * message there before any serializer runs), and through Nest's own RPC
 * exception handler. The request bound to the lines of an HTTP call carries
 * no header but an allow-list, and no query value.
 */

const EMAIL = 'jane.doe+private@example.test';
const SQL_MARK = 'mrksqltxt';
const SQL = `INSERT INTO \`user\` (\`id\`, \`email\`) VALUES (?, ?) /* ${SQL_MARK} */`;

/** A TypeORM-wrapped mysql2 duplicate entry, with the fields mysql2 sets. */
function duplicateEntry(): Error {
  const message = `Duplicate entry '${EMAIL}' for key 'user.IDX_user_email_unique'`;
  const driverError = Object.assign(new Error(message), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlState: '23000',
    sqlMessage: message,
    sql: `INSERT INTO \`user\` VALUES ('u1', '${EMAIL}') /* ${SQL_MARK} */`,
  });
  const err = new Error(message);
  Object.defineProperty(err, 'name', { value: 'QueryFailedError' });
  return Object.assign(err, {
    query: SQL,
    parameters: ['u1', EMAIL],
    driverError,
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlState: '23000',
    sqlMessage: message,
    sql: driverError.sql,
  });
}

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, done) {
    lines.push(String(chunk));
    done();
  },
});
// Without the transports: the lines go to the sink above.
const options = createLoggerOptions();
delete options.transport;
const httpOptions = createHttpLoggerOptions(Pino(options, sink));
const pinoLogger = new PinoLogger({ pinoHttp: httpOptions });
const nestLogger = new PinoNestLogger(pinoLogger, {});

function logged(write: () => void): string {
  lines.length = 0;
  write();
  return lines.join('');
}

function expectClean(out: string): void {
  expect(out).not.toBe('');
  expect(out).not.toContain(EMAIL);
  expect(out).not.toContain(SQL_MARK);
  expect(out).not.toContain('parameters');
  expect(out).not.toContain('sqlMessage');
}

describe('the service logger: an error logged alone', () => {
  it.each([
    ['PinoLogger.error(err)', () => pinoLogger.error(duplicateEntry())],
    ['Logger.error(err)', () => nestLogger.error(duplicateEntry())],
    [
      'Logger.error(err, context)',
      () => nestLogger.error(duplicateEntry(), 'UserService'),
    ],
    [
      'Logger.error(message, stack), the exception handlers’ form',
      () => {
        const err = duplicateEntry();
        nestLogger.error(err.message, err.stack);
      },
    ],
    [
      'PinoLogger.error({ err })',
      () => pinoLogger.error({ err: duplicateEntry() }),
    ],
  ])('%s keeps the value out of the message', (_name, write) => {
    const out = logged(write);

    expectClean(out);
    expect(JSON.parse(out).msg).toBe(
      "Duplicate entry '[redacted]' for key 'user.IDX_user_email_unique'",
    );
  });

  it("Nest's RPC exception handler logs an unexpected error without its value", async () => {
    NestLogger.overrideLogger(nestLogger);
    const out = await (async () => {
      lines.length = 0;
      await expect(
        lastValueFrom(
          new BaseRpcExceptionFilter().catch(duplicateEntry(), {} as never),
        ),
      ).rejects.toBeDefined();
      return lines.join('');
    })();

    expectClean(out);
    expect(out).toContain('ER_DUP_ENTRY');
    expect(out).toContain('RpcExceptionsHandler');
  });
});

describe('the service logger: an error under any key', () => {
  it.each([
    'err',
    'error',
    'context',
    'e',
    'exception',
    'cause',
    'reason',
    'data',
    'details',
    'originalError',
    'payload',
  ])(
    'logs an error under "%s" with its code, without the statement or the values',
    (key) => {
      const out = logged(() =>
        pinoLogger.error({ [key]: duplicateEntry() }, 'boom'),
      );

      expectClean(out);
      expect(out).toContain('ER_DUP_ENTRY');
      expect(out).toContain('user.IDX_user_email_unique');
    },
  );

  it('logs an error inside an array, inside an object', () => {
    const out = logged(() =>
      pinoLogger.error({ errors: [{ inner: duplicateEntry() }] }, 'boom'),
    );

    expectClean(out);
    expect(out).toContain('ER_DUP_ENTRY');
  });

  it('logs a driver error spread into the object itself without its statement or values', () => {
    const out = logged(() => pinoLogger.error({ ...duplicateEntry() }, 'boom'));

    expectClean(out);
    expect(out).toContain('ER_DUP_ENTRY');
  });

  it('keeps the inner errors of an aggregate, each summarized', () => {
    const err = new AggregateError(
      [duplicateEntry(), new Error('second failure')],
      'two writes failed',
    );

    const out = logged(() => pinoLogger.error({ err }, 'boom'));

    expectClean(out);
    const parsed = JSON.parse(out);
    expect(parsed.err.errors).toHaveLength(2);
    expect(parsed.err.errors[0].code).toBe('ER_DUP_ENTRY');
    expect(parsed.err.errors[1].message).toBe('second failure');
  });

  it('passes a plain object under "err" through, not as an empty error', () => {
    const out = logged(() =>
      pinoLogger.error({ err: { reason: 'quota', remaining: 0 } }, 'refused'),
    );

    expect(JSON.parse(out).err).toEqual({ reason: 'quota', remaining: 0 });
  });

  it('keeps the message of an ordinary error and a string context', () => {
    const out = logged(() =>
      nestLogger.error(
        { err: new Error("It's a 'quoted' thing in /var/data/report.pdf") },
        'Team',
      ),
    );

    expect(out).toContain("It's a 'quoted' thing in /var/data/report.pdf");
    expect(out).toContain('"context":"Team"');
  });
});

describe('the HTTP logger: the request bound to its lines', () => {
  const SECRETS = {
    'x-gitlab-token': 'gitlab-secret-token-1',
    'x-hub-signature-256': 'sha256=signature-value-2',
    'proxy-authorization': 'Basic proxy-credential-3',
    'x-cybedefend-service-token': 'service-token-4',
    'mcp-session-id': 'mcp-session-5',
    authorization: 'Bearer bearer-token-6',
    cookie: 'session=cookie-value-7',
    'x-api-key': 'api-key-8',
  };
  const QUERY_TOKEN = 'query-token-9';

  it('logs the method, the path and an allow-list of headers, never another header or a query value', async () => {
    // The pino-http nestjs-pino builds its middleware with.
    const pinoHttp = createRequire(require.resolve('nestjs-pino'))(
      'pino-http',
    ) as {
      pinoHttp: (
        opts: unknown,
      ) => (req: IncomingMessage, res: ServerResponse) => void;
    };
    const middleware = pinoHttp.pinoHttp(httpOptions);
    const server = createServer((req, res) => {
      middleware(req, res);
      const log = (req as IncomingMessage & { log: Pino.Logger }).log;
      log.info('handling');
      log.error({ err: duplicateEntry() });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    lines.length = 0;
    try {
      const { port } = server.address() as AddressInfo;
      await fetch(
        `http://127.0.0.1:${port}/webhooks/gitlab?token=${QUERY_TOKEN}&email=${encodeURIComponent(EMAIL)}`,
        {
          method: 'POST',
          headers: { ...SECRETS, 'content-type': 'application/json' },
          body: '{}',
        },
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    const out = lines.join('');

    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const value of [...Object.values(SECRETS), QUERY_TOKEN, EMAIL]) {
      expect(out).not.toContain(value);
    }
    const first = JSON.parse(lines[0]);
    expect(first.req.method).toBe('POST');
    expect(first.req.url).toBe('/webhooks/gitlab');
    expect(first.req.contentType).toBe('application/json');
  });
});
