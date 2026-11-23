// src/core/grpc/wrapper-grpc.spec.ts
//
// Permify hygiene: lock down the gRPC↔HTTP status
// translation surface so future contributors can't silently drift the
// mapping. The contract (gRPC code → HTTP status) is consumed by every gateway controller via `safeGrpcCall`.
//
// We exercise `safeGrpcCall` instead of the (un-exported) `grpcToHttpMap`
// because that is the public seam the codebase actually relies on — if
// the map changes, `safeGrpcCall` is the function that must keep
// returning the right HttpException for every code.
import { HttpException, HttpStatus } from '@nestjs/common';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable, of, throwError } from 'rxjs';

import { GRPC_REFUSAL_CODES, safeGrpcCall } from './wrapper-grpc';

describe('safeGrpcCall — gRPC status → HTTP mapping', () => {
  /**
   * Helper: build an Observable that throws a gRPC-style error with the
   * given numeric `code` and an optional `details` payload. Mirrors the
   * shape produced by `@grpc/grpc-js` on the wire so the wrapper's
   * `(error as any)?.code` / `details` extraction sees the real fields.
   */
  const grpcError = (code: number, details = 'boom') => () =>
    throwError(() => ({ code, details }));

  type Case = {
    name: string;
    grpcCode: number;
    httpStatus: number;
  };

  // Table-driven coverage of every mapped gRPC code. The numeric codes are taken from
  // `@grpc/grpc-js`'s `status` enum to make the table self-documenting.
  const cases: Case[] = [
    {
      name: 'CANCELLED (1) → 499 Client Closed Request',
      grpcCode: GrpcStatus.CANCELLED,
      httpStatus: 499,
    },
    {
      name: 'INVALID_ARGUMENT (3) → 400 Bad Request',
      grpcCode: GrpcStatus.INVALID_ARGUMENT,
      httpStatus: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'NOT_FOUND (5) → 404 Not Found',
      grpcCode: GrpcStatus.NOT_FOUND,
      httpStatus: HttpStatus.NOT_FOUND,
    },
    {
      name: 'ALREADY_EXISTS (6) → 409 Conflict',
      grpcCode: GrpcStatus.ALREADY_EXISTS,
      httpStatus: HttpStatus.CONFLICT,
    },
    {
      name: 'PERMISSION_DENIED (7) → 403 Forbidden',
      grpcCode: GrpcStatus.PERMISSION_DENIED,
      httpStatus: HttpStatus.FORBIDDEN,
    },
    {
      name: 'RESOURCE_EXHAUSTED (8) → 429 Too Many Requests',
      grpcCode: GrpcStatus.RESOURCE_EXHAUSTED,
      httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    },
    {
      name: 'INTERNAL (13) → 500 Internal Server Error',
      grpcCode: GrpcStatus.INTERNAL,
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    },
    {
      name: 'UNAVAILABLE (14) → 503 Service Unavailable',
      grpcCode: GrpcStatus.UNAVAILABLE,
      httpStatus: HttpStatus.SERVICE_UNAVAILABLE,
    },
    {
      name: 'UNAUTHENTICATED (16) → 401 Unauthorized',
      grpcCode: GrpcStatus.UNAUTHENTICATED,
      httpStatus: HttpStatus.UNAUTHORIZED,
    },
  ];

  it.each(cases)(
    '$name',
    async ({ grpcCode, httpStatus }) => {
      // `safeGrpcCall` swallows the original gRPC error and re-throws a
      // NestJS `HttpException`. Both the status and the upstream
      // `details` string must survive so the GlobalExceptionFilter can
      // emit a meaningful body.
      await expect(safeGrpcCall(grpcError(grpcCode)())).rejects.toBeInstanceOf(
        HttpException,
      );

      try {
        await safeGrpcCall(grpcError(grpcCode, 'upstream-detail')());
        throw new Error('unreachable');
      } catch (err) {
        const e = err as HttpException;
        expect(e.getStatus()).toBe(httpStatus);
        // The wrapper forwards `details` verbatim so operators see the
        // upstream message instead of a generic placeholder.
        expect(e.message).toBe('upstream-detail');
      }
    },
  );

  it('falls back to 500 when the gRPC code is not in the map', async () => {
    // 99 is intentionally unmapped — this guards the safety net that
    // keeps unknown statuses from surfacing as `undefined` HTTP codes.
    try {
      await safeGrpcCall(grpcError(99, 'mystery')());
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(e.message).toBe('mystery');
    }
  });

  it('falls back to error.message when `details` is absent', async () => {
    // Some gRPC clients emit `message` instead of `details`. The wrapper
    // prefers `details` but must still surface `message` — otherwise
    // every controller would log "Internal server error" with no context.
    const obs = throwError(() => ({
      code: GrpcStatus.NOT_FOUND,
      message: 'no details, only message',
    }));
    try {
      await safeGrpcCall(obs);
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(e.message).toBe('no details, only message');
    }
  });

  it('defaults code to UNKNOWN (2) when error has no `.code`', async () => {
    // Non-gRPC errors (e.g. a JS `TypeError` thrown by an interceptor)
    // should still translate to 500 rather than producing an
    // HttpException with `undefined` status. The wrapper does this by
    // defaulting `grpcCode` to 2 (UNKNOWN) which the map sends to 500.
    const obs = throwError(() => new Error('plain error'));
    try {
      await safeGrpcCall(obs);
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(e.message).toBe('plain error');
    }
  });

  // Graph-only analyses (closed-product import, re-analysis, archive) are
  // unmetered but bounded: one in flight per project, three per organisation.
  // security-scanning refuses beyond with RESOURCE_EXHAUSTED and a fixed
  // details code; the client switches on the body's `code`, never the text.
  it.each([
    ['GRAPH_ONLY_PROJECT_BUSY', 'An analysis of this project is already running'],
    [
      'GRAPH_ONLY_ORG_LIMIT',
      'Three analyses are already running in this organisation',
    ],
  ])(
    'RESOURCE_EXHAUSTED %s → 429 with that code and a fixed sentence',
    async (code, message) => {
      try {
        await safeGrpcCall(grpcError(GrpcStatus.RESOURCE_EXHAUSTED, code)());
        throw new Error('unreachable');
      } catch (err) {
        const e = err as HttpException;
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(e.getResponse()).toEqual({ code, message });
      }
    },
  );

  it('keeps any other RESOURCE_EXHAUSTED as a plain 429', async () => {
    try {
      await safeGrpcCall(
        grpcError(GrpcStatus.RESOURCE_EXHAUSTED, 'quota exceeded')(),
      );
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(e.getResponse()).toBe('quota exceeded');
    }
  });

  it('does not read a graph-only code on another gRPC status', async () => {
    try {
      await safeGrpcCall(
        grpcError(GrpcStatus.INTERNAL, 'GRAPH_ONLY_PROJECT_BUSY')(),
      );
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(e.getResponse()).toBe('GRAPH_ONLY_PROJECT_BUSY');
    }
  });

  // Stable refusal codes of the scan start routes: a listed
  // (gRPC status, message) pair leaves the gateway as an HttpException
  // whose body carries the gRPC message as `code` and a fixed sentence as
  // `message`, so clients switch on `code` whatever the edition.
  it('exports GRPC_REFUSAL_CODES keyed by gRPC status, then message', () => {
    expect(
      GRPC_REFUSAL_CODES[GrpcStatus.FAILED_PRECONDITION]?.SCANNERS_NOT_AVAILABLE,
    ).toEqual({
      status: HttpStatus.CONFLICT,
      message: 'This edition runs no scanners; import results instead.',
    });
    expect(GRPC_REFUSAL_CODES[GrpcStatus.UNAVAILABLE]?.IMPORT_UNAVAILABLE).toEqual(
      {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'The results could not be queued for processing.',
      },
    );
  });

  it('answers SCANNERS_NOT_AVAILABLE as 409 with its code', async () => {
    try {
      await safeGrpcCall(
        throwError(() => ({ code: 9, details: 'SCANNERS_NOT_AVAILABLE' })),
      );
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(e.getResponse()).toEqual({
        code: 'SCANNERS_NOT_AVAILABLE',
        message: 'This edition runs no scanners; import results instead.',
      });
    }
  });

  it('answers NO_SCANNER_ENABLED as 409 with its code and what to do', async () => {
    try {
      await safeGrpcCall(
        throwError(() => ({ code: 9, details: 'NO_SCANNER_ENABLED' })),
      );
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(e.getResponse()).toEqual({
        code: 'NO_SCANNER_ENABLED',
        message: expect.stringMatching(/no scanner enabled.*settings/i),
      });
    }
  });

  it('answers IMPORT_UNAVAILABLE as 503 with its code', async () => {
    try {
      await safeGrpcCall(
        throwError(() => ({ code: 14, details: 'IMPORT_UNAVAILABLE' })),
      );
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(e.getResponse()).toEqual({
        code: 'IMPORT_UNAVAILABLE',
        message: 'The results could not be queued for processing.',
      });
    }
  });

  it('keeps another FAILED_PRECONDITION at 400 with the server text', async () => {
    try {
      await safeGrpcCall(
        throwError(() => ({ code: 9, details: 'SOME_OTHER_REFUSAL' })),
      );
      throw new Error('unreachable');
    } catch (err) {
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(e.getResponse()).toBe('SOME_OTHER_REFUSAL');
    }
  });

  it('passes successful values through unchanged', async () => {
    // Sanity check — the happy path must not be touched by the error
    // mapping logic. Without this we could regress to "always throw".
    const { of } = await import('rxjs');
    await expect(safeGrpcCall(of({ ok: true }))).resolves.toEqual({
      ok: true,
    });
  });
});

/**
 * A gRPC call nobody answers used to wait as long as the client
 * did. An edge proxy gives up first and shows an error the gateway never logs.
 * With `deadlineMs`, safeGrpcCall gives up first, cancels the call and answers
 * a 504 that the GlobalExceptionFilter logs.
 */
describe('safeGrpcCall — deadline', () => {
  /**
   * A call the server never answers. `cancel` is what unsubscribing runs: on
   * a Nest gRPC client, the unary observable's teardown is `call.cancel()`.
   */
  const silentCall = () => {
    const cancel = jest.fn();
    return { call: new Observable<never>(() => cancel), cancel };
  };

  const failure = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => {
        throw new Error('safeGrpcCall resolved');
      },
      (error: unknown) => error,
    );

  it('answers 504 once deadlineMs has passed, and cancels the call', async () => {
    const { call, cancel } = silentCall();
    const started = Date.now();

    const error = await failure(safeGrpcCall(call, { deadlineMs: 50 }));

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.GATEWAY_TIMEOUT,
    );
    expect((error as HttpException).message).toBe(
      'Deadline of 50 ms exceeded',
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('returns an answer that arrives before the deadline', async () => {
    await expect(
      safeGrpcCall(of({ ok: true }), { deadlineMs: 50 }),
    ).resolves.toEqual({ ok: true });
  });

  it('keeps the status of an error that arrives before the deadline', async () => {
    const error = await failure(
      safeGrpcCall(
        throwError(() => ({ code: GrpcStatus.NOT_FOUND, details: 'gone' })),
        { deadlineMs: 50 },
      ),
    );

    expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect((error as HttpException).message).toBe('gone');
  });
});
