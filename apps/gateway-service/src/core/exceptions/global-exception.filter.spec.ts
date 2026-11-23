import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { errorCodes } from 'fastify';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ScanErrorCode, ScanErrorException } from './scan-error.exception';
import {
  registerFixedErrorBody,
  resetFixedErrorBodiesForTests,
} from './fixed-error-bodies';

function makeHost(url = '/test/path'): {
  host: ArgumentsHost;
  send: jest.Mock;
  status: jest.Mock;
} {
  const send = jest.fn();
  const status = jest.fn().mockReturnValue({ send });
  const response = { status };
  const request = { url };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, send, status };
}

describe('GlobalExceptionFilter — instanceof inference (no message grep)', () => {
  const filter = new GlobalExceptionFilter();

  it('BadRequestException → 400', () => {
    const { host, send, status } = makeHost();
    filter.catch(new BadRequestException('whatever'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
    );
  });

  it('keeps a string `code` of an object response (a fixed code the client can switch on)', () => {
    const { host, send, status } = makeHost();
    filter.catch(
      new ConflictException({
        code: 'RESOURCE_IN_USE',
        message: 'Release the resource before deleting it',
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        code: 'RESOURCE_IN_USE',
      }),
    );
  });

  // A fixed body registered by an extension is applied to
  // any HttpException whose object response carries its `code`.
  it('applies a registered fixed body', () => {
    registerFixedErrorBody('X_CODE', (r) => ({
      code: 'X_CODE',
      reason: String(r.reason),
    }));
    try {
      const { host, send, status } = makeHost();
      filter.catch(
        new HttpException({ code: 'X_CODE', reason: 'r', message: 'm' }, 402),
        host,
      );
      expect(status).toHaveBeenCalledWith(402);
      expect(send).toHaveBeenCalledWith({
        statusCode: 402,
        error: 'Payment Required',
        code: 'X_CODE',
        reason: 'r',
        timestamp: expect.any(String),
        path: expect.any(String),
      });
    } finally {
      resetFixedErrorBodiesForTests();
    }
  });

  it('keeps no `reason` or `unit` of another exception', () => {
    const { host, send } = makeHost();
    filter.catch(
      new ConflictException({
        code: 'X',
        reason: 'r',
        unit: 'u',
        success: false,
      }),
      host,
    );
    const body = send.mock.calls[0][0];
    expect(body).not.toHaveProperty('reason');
    expect(body).not.toHaveProperty('unit');
    expect(body).not.toHaveProperty('success');
  });

  it('adds no `code` when the object response carries none', () => {
    const { host, send } = makeHost();
    filter.catch(new ConflictException({ message: 'x' }), host);
    expect(send.mock.calls[0][0]).not.toHaveProperty('code');
  });

  it('NotFoundException → 404', () => {
    const { host, status } = makeHost();
    filter.catch(new NotFoundException('whatever'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('ForbiddenException → 403', () => {
    const { host, status } = makeHost();
    filter.catch(new ForbiddenException('whatever'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
  });

  it('ConflictException → 409', () => {
    const { host, status } = makeHost();
    filter.catch(new ConflictException('whatever'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it('UnauthorizedException → 401', () => {
    const { host, status } = makeHost();
    filter.catch(new UnauthorizedException('whatever'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });

  it('UnprocessableEntityException → 422', () => {
    const { host, status } = makeHost();
    filter.catch(new UnprocessableEntityException('whatever'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('HttpException with custom code 418 → 418 (status preserved)', () => {
    const { host, status } = makeHost();
    filter.catch(new HttpException('whatever', 418), host);
    expect(status).toHaveBeenCalledWith(418);
  });

  it('NEGATIVE: generic Error("something not found") → 500 (NOT 404 via message grep)', () => {
    const { host, send, status } = makeHost();
    filter.catch(new Error('something not found'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'something not found',
      }),
    );
  });

  it('NEGATIVE: generic Error("forbidden access") → 500 (NOT 403 via message grep)', () => {
    const { host, status } = makeHost();
    filter.catch(new Error('forbidden access'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('NEGATIVE: generic Error("unauthorized request") → 500 (NOT 401 via message grep)', () => {
    const { host, status } = makeHost();
    filter.catch(new Error('unauthorized request'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('plain Error → 500 with message preserved', () => {
    const { host, send } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'boom',
      }),
    );
  });

  it('unknown thrown value → 500', () => {
    const { host, status } = makeHost();
    filter.catch({ random: 'thing' }, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  // ------------------------------------------------------------------
  // gRPC path: status must come from `code`, not message
  // ------------------------------------------------------------------
  //
  // An `INTERNAL` error whose detail happens to contain "unauthorized" must
  // not flip to a 401. These tests pin the behaviour: only the numeric code
  // drives the HTTP status; unmapped codes default to 500.
  describe('gRPC path — code drives status, message does not', () => {
    it('gRPC INTERNAL with message containing "unauthorized" → 500 (not 401)', () => {
      const { host, status, send } = makeHost();
      filter.catch(
        new RpcException({ code: 13, message: 'INTERNAL: unauthorized' }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'INTERNAL: unauthorized',
        }),
      );
    });

    it('gRPC INTERNAL with message containing "forbidden" → 500 (not 403)', () => {
      const { host, status } = makeHost();
      filter.catch(
        new RpcException({ code: 13, message: 'INTERNAL: forbidden' }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('gRPC INTERNAL with message containing "permission denied" → 500 (not 403)', () => {
      const { host, status } = makeHost();
      filter.catch(
        new RpcException({
          code: 13,
          message: 'INTERNAL: permission denied for resource',
        }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('gRPC UNAUTHENTICATED keeps 401 from the numeric code', () => {
      const { host, status } = makeHost();
      filter.catch(
        new RpcException({ code: 16, message: 'token expired' }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    });

    it('gRPC PERMISSION_DENIED keeps 403 from the numeric code', () => {
      const { host, status } = makeHost();
      filter.catch(
        new RpcException({ code: 7, message: 'denied by policy' }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    });

    it('gRPC NOT_FOUND keeps 404', () => {
      const { host, status } = makeHost();
      filter.catch(new RpcException({ code: 5, message: 'not here' }), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('gRPC INVALID_ARGUMENT keeps 400', () => {
      const { host, status } = makeHost();
      filter.catch(new RpcException({ code: 3, message: 'bad' }), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('gRPC RESOURCE_EXHAUSTED keeps 429', () => {
      const { host, status } = makeHost();
      filter.catch(new RpcException({ code: 8, message: 'quota' }), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    });

    it('gRPC UNAVAILABLE keeps 503', () => {
      const { host, status } = makeHost();
      filter.catch(new RpcException({ code: 14, message: 'down' }), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('plain gRPC error (raw object) with unknown code → 500, message preserved', () => {
      // Plain gRPC-shaped object (`code` + `details`) — exercises the
      // `isGrpcError` branch. Unknown numeric code MUST default to 500.
      const { host, status, send } = makeHost();
      filter.catch(
        { code: 99, details: 'connection refused, unauthorized' },
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        }),
      );
    });

    it('plain gRPC error with INTERNAL (13) code → 500 regardless of details content', () => {
      const { host, status } = makeHost();
      // Even if the details string carries trigger words, the numeric code
      // is the only signal we honour now.
      filter.catch(
        { code: 13, details: 'forbidden permission denied timeout 401' },
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('RpcException with string payload → 500 (no message grep)', () => {
      // A bare-string RpcException payload is never scanned for trigger
      // words: the status MUST default to 500.
      const { host, status } = makeHost();
      filter.catch(new RpcException('something went unauthorized'), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });
});

describe('GlobalExceptionFilter — a plain Error carrying a 4xx statusCode', () => {
  // Fastify and its plugins reject a request with a plain Error carrying
  // `statusCode`, not with an HttpException: @fastify/static's forbidden path
  // (robots probing `../../proc/self/environ`) and an oversized body. Both
  // must not leave as 500: they are client mistakes.
  const filter = new GlobalExceptionFilter();

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('@fastify/static forbidden path (statusCode 403) → 403', () => {
    const { host, send, status } = makeHost('/api/w/x/../../proc/self/environ');
    const forbidden = Object.assign(new Error('Forbidden'), {
      status: 403,
      statusCode: 403,
    });

    filter.catch(forbidden, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        message: 'Forbidden',
      }),
    );
  });

  it("Fastify's body too large (FST_ERR_CTP_BODY_TOO_LARGE) → 413", () => {
    const { host, send, status } = makeHost('/marketing/leads');

    filter.catch(new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: 'Payload Too Large',
      }),
    );
  });

  it('a plain Error without statusCode stays a 500', () => {
    const { host, status } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it.each([
    ['a 5xx', 503],
    ['a redirect', 302],
    ['a string', '404'],
  ])('a statusCode that is %s stays a 500', (_label, statusCode) => {
    const { host, status } = makeHost();
    filter.catch(Object.assign(new Error('boom'), { statusCode }), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

describe('GlobalExceptionFilter — secret carried in the request path', () => {
  // POST /webhooks/jira/:token — Jira's dynamic webhooks cannot send a custom
  // header, so the shared secret is the last path segment.
  const secret = 'fixture-jira-webhook-secret-value';
  const filter = new GlobalExceptionFilter();
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('masks it in the URL of the 4xx warning', () => {
    const { host } = makeHost(`/webhooks/jira/${secret}`);

    filter.catch(new BadRequestException('Invalid webhook secret'), host);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('/webhooks/jira/[REDACTED]');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });

  it('masks it in the warning of a 4xx a framework Error carries', () => {
    const { host, send, status } = makeHost(`/webhooks/jira/${secret}`);

    filter.catch(
      Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(warn).toHaveBeenCalledWith(
      '[403] Forbidden - /webhooks/jira/[REDACTED]',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
    expect(error).not.toHaveBeenCalled();
  });

  it('masks it in the path echoed in the error body', () => {
    const { host, send } = makeHost(`/webhooks/jira/${secret}`);

    filter.catch(new RpcException({ code: 14, message: 'unavailable' }), host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/webhooks/jira/[REDACTED]' }),
    );
    expect(JSON.stringify(send.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
  });

  it('keeps any other URL readable', () => {
    const { host, send } = makeHost('/project/7b1c/results/sast?page=2');

    filter.catch(new NotFoundException('Project not found'), host);

    expect(warn.mock.calls[0][0]).toContain(
      '/project/7b1c/results/sast?page=2',
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/project/7b1c/results/sast?page=2' }),
    );
  });
});

describe('GlobalExceptionFilter — Retry-After on a 429', () => {
  const filter = new GlobalExceptionFilter();

  function makeReplyHost(): {
    host: ArgumentsHost;
    header: jest.Mock;
    status: jest.Mock;
  } {
    const send = jest.fn();
    const status = jest.fn().mockReturnValue({ send });
    const header = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, header }),
        getRequest: () => ({ url: '/p' }),
      }),
    } as unknown as ArgumentsHost;
    return { host, header, status };
  }

  it('sets the header from the exception’s retryAfter', () => {
    const { host, header, status } = makeReplyHost();
    filter.catch(
      new HttpException(
        { message: 'Too many requests', retryAfter: 120 },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      host,
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(header).toHaveBeenCalledWith('Retry-After', '120');
  });

  it.each([0, -1, 1.5, 86401, '60', 'soon'])(
    'sets no header for an unusable retryAfter (%p)',
    (retryAfter) => {
      const { host, header } = makeReplyHost();
      filter.catch(
        new HttpException(
          { message: 'Too many requests', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
        host,
      );
      expect(header).not.toHaveBeenCalled();
    },
  );

  it('sets no header on a status other than 429', () => {
    const { host, header } = makeReplyHost();
    filter.catch(
      new HttpException({ message: 'down', retryAfter: 30 }, 503),
      host,
    );
    expect(header).not.toHaveBeenCalled();
  });

  it('sets no header on a 429 without retryAfter', () => {
    const { host, header } = makeReplyHost();
    filter.catch(new HttpException('slow down', 429), host);
    expect(header).not.toHaveBeenCalled();
  });
});

// HttpException carries its own string `errorCode` (a machine-readable code),
// so the numeric scan code lives in `scanErrorCode`; the response body keeps
// the numeric `errorCode` clients already read.
describe('GlobalExceptionFilter — ScanErrorException', () => {
  const filter = new GlobalExceptionFilter();

  it('answers with the numeric scan code as errorCode', () => {
    const { host, send, status } = makeHost();
    const exception = new ScanErrorException(ScanErrorCode.AUTH_ERROR);
    expect(exception.scanErrorCode).toBe(ScanErrorCode.AUTH_ERROR);
    filter.catch(exception, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ScanErrorCode.AUTH_ERROR,
        errorCategory: 'authentication',
      }),
    );
  });
});
