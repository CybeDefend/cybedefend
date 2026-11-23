import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { Observable, of, throwError } from 'rxjs';

import { CLUSTER_SCAN_SERVICE_NAME } from '@grpc/security-scanning/security_scanning';
import { ScanRunClient } from './scan-run.client';
import {
  SCAN_TOKEN_PATTERN,
  ScanRunRequest,
  ScanUploadTokenGuard,
} from './scan-upload-token.guard';

const SCAN = '1f0b7c1e-9c1a-6a40-8000-000000000001';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTAINER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = `cdst_${'A'.repeat(20)}-_${'z'.repeat(21)}`;
const HASH = createHash('sha256').update(TOKEN).digest('hex');

type Req = Record<string, unknown>;
const grpcError = (code: number, details: string): Observable<unknown> =>
  throwError(() => ({ code, details }));

describe('ScanUploadTokenGuard', () => {
  const clusterClient = {
    getScanCapabilities: jest.fn(),
    authorizeScanUpload: jest.fn(
      (_req: Req, _metadata?: unknown): Observable<unknown> =>
        of({
          projectId: PROJECT,
          organizationId: ORG,
          containerId: CONTAINER,
          category: 'sast',
        }),
    ),
    submitScanResults: jest.fn(),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  let guard: ScanUploadTokenGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    const client = new ScanRunClient({
      getService: (name: string) =>
        name === CLUSTER_SCAN_SERVICE_NAME ? clusterClient : undefined,
    } as never);
    client.onModuleInit();
    guard = new ScanUploadTokenGuard(client, logger as unknown as Logger);
  });

  const requestOf = (
    headers: Record<string, unknown>,
    scanId: string = SCAN,
  ): ScanRunRequest =>
    ({ headers, params: { scanId } }) as unknown as ScanRunRequest;

  const contextOf = (req: ScanRunRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  const refusalOf = async (req: ScanRunRequest) => {
    try {
      await guard.canActivate(contextOf(req));
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const e = error as HttpException;
      return {
        status: e.getStatus(),
        body: e.getResponse() as { code?: string; message?: string },
      };
    }
    throw new Error('the guard let the request through');
  };

  const valid = {
    authorization: `Bearer ${TOKEN}`,
    'x-cybedefend-scan-protocol': '1',
  };

  it('the token pattern is the global constraint', () => {
    expect(SCAN_TOKEN_PATTERN.source).toBe('^cdst_[A-Za-z0-9_-]{43}$');
    expect(SCAN_TOKEN_PATTERN.test(TOKEN)).toBe(true);
  });

  it.each([
    ['no authorization header', {}],
    ['a basic scheme', { authorization: `Basic ${TOKEN}` }],
    ['a personal access token', { authorization: 'Bearer cdp_abc' }],
    [
      'a token one character short',
      { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
    ],
    ['a token with a dot', { authorization: `Bearer ${TOKEN.slice(0, -1)}.` }],
    ['two spaces', { authorization: `Bearer  ${TOKEN}` }],
    [
      'a repeated header',
      { authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] },
    ],
  ])(
    'a malformed token (%s) is 401 SCAN_TOKEN_INVALID without a gRPC call',
    async (_name, headers) => {
      const refusal = await refusalOf(
        requestOf({ ...headers, 'x-cybedefend-scan-protocol': '1' }),
      );
      expect(refusal.status).toBe(401);
      expect(refusal.body.code).toBe('SCAN_TOKEN_INVALID');
      expect(clusterClient.authorizeScanUpload).not.toHaveBeenCalled();
    },
  );

  it('a scan id that is not a UUID is 401 SCAN_TOKEN_INVALID without a gRPC call', async () => {
    const refusal = await refusalOf(requestOf(valid, '../../etc'));
    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBe('SCAN_TOKEN_INVALID');
    expect(clusterClient.authorizeScanUpload).not.toHaveBeenCalled();
  });

  it('sends the SHA-256 hex of the token, never the token, and puts the answer on the request', async () => {
    const req = requestOf(valid);
    await expect(guard.canActivate(contextOf(req))).resolves.toBe(true);
    expect(clusterClient.authorizeScanUpload).toHaveBeenCalledTimes(1);
    const sent = clusterClient.authorizeScanUpload.mock.calls[0][0];
    expect(sent).toEqual({
      scanId: SCAN,
      tokenHash: HASH,
      protocolVersion: 1,
    });
    expect(JSON.stringify(sent)).not.toContain('cdst_');
    expect(req.scanRun).toEqual({
      scanId: SCAN,
      tokenHash: HASH,
      projectId: PROJECT,
      organizationId: ORG,
      containerId: CONTAINER,
      category: 'sast',
      protocolVersion: 1,
    });
  });

  it('protocol header 2 is sent as 2 and lands on the request, for the handler to allow an SBOM', async () => {
    const req = requestOf({ ...valid, 'x-cybedefend-scan-protocol': '2' });
    await expect(guard.canActivate(contextOf(req))).resolves.toBe(true);
    expect(clusterClient.authorizeScanUpload.mock.calls[0][0]).toMatchObject({
      protocolVersion: 2,
    });
    expect(req.scanRun?.protocolVersion).toBe(2);
  });

  it('protocol header 3 ⇒ 400 SCAN_PROTOCOL_UNSUPPORTED', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.FAILED_PRECONDITION, 'SCAN_PROTOCOL_UNSUPPORTED'),
    );
    const refusal = await refusalOf(
      requestOf({ ...valid, 'x-cybedefend-scan-protocol': '3' }),
    );
    expect(clusterClient.authorizeScanUpload.mock.calls[0][0]).toMatchObject({
      protocolVersion: 3,
    });
    expect(refusal.status).toBe(400);
    expect(refusal.body.code).toBe('SCAN_PROTOCOL_UNSUPPORTED');
  });

  it('missing header ⇒ protocol_version 0 ⇒ 400', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'SCAN_PROTOCOL_UNSUPPORTED'),
    );
    const refusal = await refusalOf(
      requestOf({ authorization: `Bearer ${TOKEN}` }),
    );
    expect(clusterClient.authorizeScanUpload.mock.calls[0][0]).toMatchObject({
      protocolVersion: 0,
    });
    expect(refusal.status).toBe(400);
    expect(refusal.body.code).toBe('SCAN_PROTOCOL_UNSUPPORTED');
  });

  it.each(['abc', '1.5', '-1', ' 1', '99999999999'])(
    'a protocol header %p that is not a small integer is sent as 0',
    async (value) => {
      clusterClient.authorizeScanUpload.mockReturnValueOnce(
        grpcError(GrpcStatus.FAILED_PRECONDITION, 'SCAN_PROTOCOL_UNSUPPORTED'),
      );
      const refusal = await refusalOf(
        requestOf({ ...valid, 'x-cybedefend-scan-protocol': value }),
      );
      expect(clusterClient.authorizeScanUpload.mock.calls[0][0]).toMatchObject({
        protocolVersion: 0,
      });
      expect(refusal.status).toBe(400);
    },
  );

  it('a spent token ⇒ 409 SCAN_RESULTS_ALREADY_SUBMITTED', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.ALREADY_EXISTS, 'SCAN_RESULTS_ALREADY_SUBMITTED'),
    );
    const refusal = await refusalOf(requestOf(valid));
    expect(refusal.status).toBe(409);
    expect(refusal.body.code).toBe('SCAN_RESULTS_ALREADY_SUBMITTED');
  });

  it('an unknown or expired token ⇒ 401 SCAN_TOKEN_INVALID', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAUTHENTICATED, 'SCAN_TOKEN_INVALID'),
    );
    const refusal = await refusalOf(requestOf(valid));
    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBe('SCAN_TOKEN_INVALID');
  });

  it('a security-scanning that serves no ClusterScanService (the cloud) ⇒ 401', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.UNIMPLEMENTED, 'Method not found'),
    );
    const refusal = await refusalOf(requestOf(valid));
    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBe('SCAN_TOKEN_INVALID');
  });

  it('an unreachable security-scanning ⇒ 503 IMPORT_UNAVAILABLE with a fixed message', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      grpcError(GrpcStatus.UNAVAILABLE, `connect ECONNREFUSED ${HASH}`),
    );
    const refusal = await refusalOf(requestOf(valid));
    expect(refusal.status).toBe(503);
    expect(refusal.body.code).toBe('IMPORT_UNAVAILABLE');
    expect(JSON.stringify(refusal.body)).not.toContain(HASH);
    expect(logger.warn).toHaveBeenCalledWith(
      `SCAN_RUN_UPLOAD_REFUSED scan=${SCAN} step=authorize status=UNAVAILABLE`,
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(HASH);
  });

  it('an answer naming a container that is not a UUID ⇒ 503, nothing on the request', async () => {
    clusterClient.authorizeScanUpload.mockReturnValueOnce(
      of({
        projectId: PROJECT,
        organizationId: ORG,
        containerId: '../x',
        category: 'sast',
      }),
    );
    const req = requestOf(valid);
    const refusal = await refusalOf(req);
    expect(refusal.status).toBe(503);
    expect(refusal.body.code).toBe('IMPORT_UNAVAILABLE');
    expect(req.scanRun).toBeUndefined();
  });
});
