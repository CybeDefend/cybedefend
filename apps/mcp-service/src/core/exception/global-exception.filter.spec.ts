import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

interface CapturedResponse {
  statusCode?: number;
  body?: unknown;
}

function mockHost(reqUrl = '/some/path'): {
  host: ArgumentsHost;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = {};
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    send(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const request = { url: reqUrl };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    // Silence noisy logger output during tests
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((filter as any).logger, 'warn').mockImplementation(() => {});
  });

  it('passes through HttpException with preserved status code and message', () => {
    const { host, captured } = mockHost('/api/resource');
    const exception = new NotFoundException('Resource not found');

    filter.catch(exception, host);

    expect(captured.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body).toMatchObject({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      message: 'Resource not found',
      path: '/api/resource',
    });
    expect((captured.body as any).timestamp).toEqual(expect.any(String));
  });

  it('preserves object responses from HttpException (errorCode, errorCategory, retriable)', () => {
    const { host, captured } = mockHost('/any');
    const exception = new HttpException(
      {
        message: 'Quota exceeded',
        errorCode: 42,
        errorCategory: 'quota',
        retriable: true,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(captured.statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(captured.body).toMatchObject({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Quota exceeded',
      errorCode: 42,
      errorCategory: 'quota',
      retriable: true,
    });
  });

  it('maps a generic Error (unknown keywords) to 500 Internal Server Error', () => {
    const { host, captured } = mockHost('/boom');
    const err = new Error('Something totally unexpected');

    filter.catch(err, host);

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    // A fixed message: the error's own text stays in the logs.
    expect(captured.body).toMatchObject({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      path: '/boom',
    });
  });

  it('maps an unknown thrown value (e.g. a raw string) to 500 with sane fallback', () => {
    const { host, captured } = mockHost('/weird');

    filter.catch('a raw string was thrown', host);

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toMatchObject({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      path: '/weird',
    });
  });

  it('maps an unknown plain object (no .message) to 500 with sane fallback', () => {
    const { host, captured } = mockHost('/nope');

    filter.catch({ randomKey: 'value' }, host);

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toMatchObject({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });
});
