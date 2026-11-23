import 'reflect-metadata';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { NEVER, Observable, of, throwError } from 'rxjs';

import { CLUSTER_SCAN_SERVICE_NAME } from '@grpc/security-scanning/security_scanning';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import {
  INSTANCE_CAPABILITIES_DEADLINE_MS,
  InstanceController,
} from './instance.controller';

const grpcError = (code: number) =>
  Object.assign(new Error(`${code} ${GrpcStatus[code]}: downstream text`), {
    code,
    details: 'downstream text',
  });

describe('GET /instance/capabilities', () => {
  let app: NestFastifyApplication;
  let answer: () => Observable<unknown>;
  const getScanCapabilities = jest.fn((..._args: unknown[]) => answer());
  const getService = jest.fn(() => ({ getScanCapabilities }));
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let authenticated = true;

  beforeEach(async () => {
    jest.clearAllMocks();
    authenticated = true;
    const moduleRef = await Test.createTestingModule({
      controllers: [InstanceController],
      providers: [
        { provide: 'SECURITY_SCANNING_SERVICE', useValue: { getService } },
        { provide: Logger, useValue: logger },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => authenticated })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  const get = () =>
    app.inject({ method: 'GET', url: '/instance/capabilities' });

  it.each([true, false])(
    'answers clusterScans from security-scanning (%s)',
    async (clusterScans) => {
      answer = () => of({ clusterScans });
      const res = await get();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ clusterScans });
      expect(getService).toHaveBeenCalledWith(CLUSTER_SCAN_SERVICE_NAME);
      expect(getScanCapabilities).toHaveBeenCalledTimes(1);
      expect(getScanCapabilities.mock.calls[0][0]).toEqual({});
      expect(logger.warn).not.toHaveBeenCalled();
    },
  );

  it('reads an absent field (proto3 default) as false', async () => {
    answer = () => of({});
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ clusterScans: false });
  });

  it('an older security-scanning (UNIMPLEMENTED) answers clusterScans false', async () => {
    answer = () => throwError(() => grpcError(GrpcStatus.UNIMPLEMENTED));
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ clusterScans: false });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    GrpcStatus.UNAVAILABLE,
    GrpcStatus.INTERNAL,
    GrpcStatus.DEADLINE_EXCEEDED,
  ])(
    'a failure (%s) answers 503 INSTANCE_CAPABILITIES_UNAVAILABLE, never 200 false',
    async (code) => {
      answer = () => throwError(() => grpcError(code));
      const res = await get();
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body).toMatchObject({
        statusCode: 503,
        code: 'INSTANCE_CAPABILITIES_UNAVAILABLE',
        path: '/instance/capabilities',
      });
      expect(JSON.stringify(body)).not.toContain('downstream text');
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        `INSTANCE_CAPABILITIES_UNAVAILABLE status=${GrpcStatus[code]}`,
      );
    },
  );

  it('a call past the 2 s deadline answers 503 and logs DEADLINE_EXCEEDED', async () => {
    expect(INSTANCE_CAPABILITIES_DEADLINE_MS).toBe(2_000);
    answer = () => NEVER;
    const started = Date.now();
    const res = await get();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('INSTANCE_CAPABILITIES_UNAVAILABLE');
    expect(logger.warn).toHaveBeenCalledWith(
      'INSTANCE_CAPABILITIES_UNAVAILABLE status=DEADLINE_EXCEEDED',
    );
  }, 10_000);

  it('refuses an unauthenticated caller before any gRPC call', async () => {
    authenticated = false;
    answer = () => of({ clusterScans: true });
    const res = await get();
    expect(res.statusCode).toBe(403);
    expect(getScanCapabilities).not.toHaveBeenCalled();
  });
});
