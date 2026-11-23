import { ErrorLoggingInterceptor } from './error-logging.interceptor';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { throwError, lastValueFrom } from 'rxjs';

type AnyLogger = Pick<Logger, 'log' | 'warn' | 'error' | 'debug'>;

function mockLogger(): AnyLogger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function mockHttpContext(req: {
  url: string;
  method: string;
}): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToRpc: () => ({
      getContext: () => ({}),
      getData: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('ErrorLoggingInterceptor', () => {
  it('logs main_request with url and method from HTTP context on unknown errors', async () => {
    const logger = mockLogger();
    const interceptor = new ErrorLoggingInterceptor(
      logger as unknown as Logger,
    );
    const ctx = mockHttpContext({ url: '/mcp', method: 'POST' });

    const err = new Error('boom');
    const handler: CallHandler = { handle: () => throwError(() => err) };

    await expect(
      lastValueFrom(interceptor.intercept(ctx, handler)),
    ).rejects.toThrow('boom');

    expect(logger.error).toHaveBeenCalledTimes(1);
    const msg = (logger.error as jest.Mock).mock.calls[0][0] as string;
    // The interceptor serializes request via JSON.stringify; verify url+method appear.
    expect(msg).toContain('"url":"/mcp"');
    expect(msg).toContain('"method":"POST"');
  });
});
