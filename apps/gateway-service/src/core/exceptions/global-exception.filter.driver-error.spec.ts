import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Module,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * An unexpected error reaches the client as a fixed message with its status
 * and path, never its own text: a database error's message quotes the
 * value it refused, and its fields hold the statement and its parameters.
 * The log line keeps the error's code without the values. A deliberate client
 * error (an HttpException) keeps its own message.
 */

const EMAIL = 'jane.doe+private@example.test';
const SQL_MARK = 'mrksqltxt';

/** A TypeORM-wrapped mysql2 duplicate entry, as a handler would let it escape. */
function duplicateEntry(): Error {
  const message = `Duplicate entry '${EMAIL}' for key 'user.IDX_user_email_unique'`;
  const err = new Error(message);
  Object.defineProperty(err, 'name', { value: 'QueryFailedError' });
  return Object.assign(err, {
    query: `INSERT INTO \`user\` (\`email\`) VALUES (?) /* ${SQL_MARK} */`,
    parameters: [EMAIL],
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: message,
  });
}

@Controller()
class FailingController {
  @Get('/driver-error')
  driverError(): never {
    throw duplicateEntry();
  }

  @Get('/downstream-unknown')
  downstreamUnknown(): never {
    // What a gRPC call returns when the service let an error escape.
    throw Object.assign(new Error(`2 UNKNOWN: ${duplicateEntry().message}`), {
      code: 2,
      details: duplicateEntry().message,
    });
  }

  @Get('/rpc-unknown')
  rpcUnknown(): never {
    throw new RpcException({ code: 2, message: duplicateEntry().message });
  }

  @Get('/client-error')
  clientError(): never {
    throw new BadRequestException('name must be 255 characters or fewer');
  }
}

@Module({ controllers: [FailingController] })
class FailingModule {}

describe('GlobalExceptionFilter: an unexpected error thrown by a handler', () => {
  let app: NestFastifyApplication;
  const logged: string[] = [];

  beforeAll(async () => {
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      });
    app = await NestFactory.create<NestFastifyApplication>(
      FailingModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    logged.length = 0;
  });

  it.each(['/driver-error', '/downstream-unknown', '/rpc-unknown'])(
    '%s answers 500 with a fixed message and logs the error without its values',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain(EMAIL);
      expect(res.body).not.toContain('Duplicate entry');
      expect(res.body).not.toContain(SQL_MARK);
      expect(res.json()).toEqual(
        expect.objectContaining({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
          path: url,
        }),
      );
      const log = logged.join('\n');
      expect(log).not.toBe('');
      expect(log).not.toContain(EMAIL);
      expect(log).not.toContain(SQL_MARK);
    },
  );

  it('keeps the message of a deliberate client error', async () => {
    const res = await app.inject({ method: 'GET', url: '/client-error' });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('name must be 255 characters or fewer');
  });
});
