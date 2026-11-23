// Both halves of scanner-call authentication on one real gRPC server: the
// service-auth interceptor turns a scanner token into identity headers, and
// the handler's ScannerCallGuard binds that identity to the request. Each
// half has its own spec; this one proves the headers the interceptor writes
// are the ones the guard reads, and that nothing a client writes itself
// reaches the guard as an identity.
import {
  Metadata,
  Server,
  ServerCredentials,
  ServiceDefinition,
  credentials,
  makeGenericClientConstructor,
  status,
} from '@grpc/grpc-js';
import type { ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import type {
  ScannerCall,
  ScannerCallBinding,
} from '../../edition/ports/scanner-call-binding.port';
import { createServiceAuthServerInterceptor } from '../service-auth/service-auth';
import { SERVICE_AUTH_POLICY } from '../service-auth/service-auth.policy';
import {
  SCANNER_AUTH_HEADER,
  SCANNER_AUTH_NOT_BOUND,
  SCANNER_AUTH_REQUIRED,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
  SCANNER_TOKEN_HEADER,
  type ScannerAuthMode,
  type ScannerCredentials,
  type ScannerTokenCheck,
} from './scanner-auth.contract';
import { ScannerCallGuard, scannerIdentityOf } from './scanner-call.guard';

const UPDATE_SCAN = '/cybedefend.security_scanning.ScanService/UpdateScan';
const IDENTITY = {
  pod: 'scan-pod-sast-1',
  podUid: 'uid-1',
  namespace: 'scanners-namespace',
  scanId: 'scan-1',
  projectId: 'project-1',
};
const FORGED = {
  [SCANNER_POD_HEADER]: 'forged-pod',
  [SCANNER_POD_UID_HEADER]: 'forged-uid',
  [SCANNER_NAMESPACE_HEADER]: 'forged-namespace',
  [SCANNER_SCAN_ID_HEADER]: 'scan-2',
  [SCANNER_PROJECT_ID_HEADER]: 'project-2',
  [SCANNER_AUTH_HEADER]: 'ok',
};

const json = {
  requestStream: false,
  responseStream: false,
  requestSerialize: (v: unknown) => Buffer.from(JSON.stringify(v)),
  requestDeserialize: (b: Buffer) => JSON.parse(b.toString()) as unknown,
  responseSerialize: (v: unknown) => Buffer.from(JSON.stringify(v)),
  responseDeserialize: (b: Buffer) => JSON.parse(b.toString()) as unknown,
};
const DEFINITION = {
  UpdateScan: { ...json, path: UPDATE_SCAN, originalName: 'UpdateScan' },
} as unknown as ServiceDefinition;

interface Seen {
  identity: typeof IDENTITY | null;
  pod: string[];
}
type Answer = { code: number; details?: string; seen?: Seen };

function contextOf(
  request: unknown,
  metadata: Metadata,
  call: { getPath(): string; getPeer(): string },
): ExecutionContext {
  class ScanController {}
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({ getData: () => request, getContext: () => metadata }),
    getArgByIndex: (index: number) =>
      [request, metadata, call][index] as unknown,
    getClass: () => ScanController,
    getHandler: () => function updateScan() {},
  } as unknown as ExecutionContext;
}

describe('a scanner call through the interceptor and the guard', () => {
  let server: Server;
  let address: string;
  let interceptorMode: ScannerAuthMode;
  const savedMode = process.env.SCANNER_AUTH_MODE;
  // The binding covers a call whose request names the scan of its token.
  const bound: ScannerCall[] = [];
  const binding: ScannerCallBinding = {
    bind: async (call) => {
      bound.push(call);
      const scanId = (call.request as { scanId?: string }).scanId;
      return scanId === call.identity.scanId ? 'ok' : 'not-bound';
    },
  };
  const scannerCredentials: ScannerCredentials = {
    verify: (token): ScannerTokenCheck =>
      token === 'k8s.good' ? IDENTITY : { reason: 'invalid' },
  };
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    server = new Server({
      interceptors: [
        createServiceAuthServerInterceptor({
          policy: () => SERVICE_AUTH_POLICY,
          keys: () => [],
          mode: () => 'enforce',
          allowScannerCalls: () => true,
          logger: { warn: () => undefined },
          scannerCredentials: () => scannerCredentials,
          scannerMode: () => interceptorMode,
          scannerReporter: { refused: () => undefined },
        }),
      ],
    } as never);
    const guard = new ScannerCallGuard(binding);
    server.addService(DEFINITION, {
      UpdateScan: (
        call: {
          request: unknown;
          metadata: Metadata;
          getPath(): string;
          getPeer(): string;
        },
        cb: (err: unknown, res?: Seen) => void,
      ) => {
        guard
          .canActivate(contextOf(call.request, call.metadata, call))
          .then(() =>
            cb(null, {
              identity: scannerIdentityOf(call.metadata),
              pod: call.metadata.get(SCANNER_POD_HEADER) as string[],
            }),
          )
          .catch((error: unknown) => {
            const refusal =
              error instanceof RpcException
                ? (error.getError() as { code: number; message: string })
                : { code: status.INTERNAL, message: String(error) };
            cb({ code: refusal.code, details: refusal.message });
          });
      },
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (err, p) => (err ? reject(err) : resolve(p)),
      ),
    );
    address = `127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.forceShutdown();
    if (savedMode === undefined) delete process.env.SCANNER_AUTH_MODE;
    else process.env.SCANNER_AUTH_MODE = savedMode;
  });

  beforeEach(() => {
    interceptorMode = 'enforce';
    process.env.SCANNER_AUTH_MODE = 'enforce';
    bound.length = 0;
    // The guard's refusals go to the process-wide reporter (console).
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  function updateScan(
    request: { scanId: string },
    headers: Record<string, string>,
  ): Promise<Answer> {
    const Ctor = makeGenericClientConstructor(DEFINITION, 'ScanService');
    const client = new Ctor(
      address,
      credentials.createInsecure(),
    ) as unknown as {
      UpdateScan(
        req: unknown,
        md: Metadata,
        cb: (
          err: { code?: number; details?: string } | null,
          res?: Seen,
        ) => void,
      ): void;
      close(): void;
    };
    const metadata = new Metadata();
    for (const [name, value] of Object.entries(headers))
      metadata.set(name, value);
    return new Promise((resolve) =>
      client.UpdateScan(request, metadata, (err, res) => {
        client.close();
        resolve(
          err
            ? { code: err.code ?? -1, details: err.details }
            : { code: status.OK, seen: res },
        );
      }),
    );
  }

  it('a verified scanner call reaches the guard with its identity and an unbound one is refused in enforce', async () => {
    const own = await updateScan(
      { scanId: 'scan-1' },
      { [SCANNER_TOKEN_HEADER]: 'k8s.good' },
    );
    expect(own).toEqual({
      code: status.OK,
      seen: { identity: IDENTITY, pod: [IDENTITY.pod] },
    });
    expect(bound).toEqual([
      {
        method: UPDATE_SCAN,
        identity: IDENTITY,
        request: { scanId: 'scan-1' },
      },
    ]);

    const other = await updateScan(
      { scanId: 'scan-2' },
      { [SCANNER_TOKEN_HEADER]: 'k8s.good' },
    );
    expect(other).toEqual({
      code: status.PERMISSION_DENIED,
      details: SCANNER_AUTH_NOT_BOUND,
    });
    expect(bound).toHaveLength(2);
  });

  it('a verified token wins over the identity headers a client sends with it', async () => {
    const answer = await updateScan(
      { scanId: 'scan-2' },
      { ...FORGED, [SCANNER_TOKEN_HEADER]: 'k8s.good' },
    );
    expect(answer).toEqual({
      code: status.PERMISSION_DENIED,
      details: SCANNER_AUTH_NOT_BOUND,
    });
    expect(bound.map((call) => call.identity)).toEqual([IDENTITY]);
  });

  it('client-forged identity headers without a token never reach the guard as an identity', async () => {
    // Enforce: the interceptor answers before any handler runs.
    expect(await updateScan({ scanId: 'scan-2' }, FORGED)).toEqual({
      code: status.UNAUTHENTICATED,
      details: SCANNER_AUTH_REQUIRED,
    });
    expect(
      await updateScan(
        { scanId: 'scan-2' },
        { ...FORGED, [SCANNER_TOKEN_HEADER]: 'k8s.forged' },
      ),
    ).toEqual({ code: status.UNAUTHENTICATED, details: SCANNER_AUTH_REQUIRED });

    // Verify: the call is served, marked missing, with no identity at all.
    interceptorMode = 'verify';
    expect(await updateScan({ scanId: 'scan-2' }, FORGED)).toEqual({
      code: status.OK,
      seen: { identity: null, pod: [] },
    });
    expect(bound).toEqual([]);
  });
});
