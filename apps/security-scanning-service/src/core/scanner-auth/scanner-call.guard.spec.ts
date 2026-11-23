import { Metadata, status } from '@grpc/grpc-js';
import type { ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import type {
  ScannerCall,
  ScannerCallBinding,
} from '../../edition/ports/scanner-call-binding.port';
import { scannerAuthReporter } from '../service-auth/scanner-call-auth';
import {
  SCANNER_AUTH_HEADER,
  SCANNER_AUTH_NOT_BOUND,
  SCANNER_AUTH_LOOKUP_FAILED,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
  type ScannerBindingAnswer,
} from './scanner-auth.contract';
import { ScannerCallGuard, scannerIdentityOf } from './scanner-call.guard';

const IDENTITY = {
  pod: 'scan-pod-sast-1',
  podUid: 'uid-1',
  namespace: 'scanners-namespace',
  scanId: 'scan-1',
  projectId: 'project-1',
};
const PATH = '/cybedefend.security_scanning.ScanService/UpdateScan';

function metadataWith(headers: Record<string, string>): Metadata {
  const metadata = new Metadata();
  for (const [key, value] of Object.entries(headers)) metadata.set(key, value);
  return metadata;
}

function verified(): Metadata {
  return metadataWith({
    [SCANNER_AUTH_HEADER]: 'ok',
    [SCANNER_POD_HEADER]: IDENTITY.pod,
    [SCANNER_POD_UID_HEADER]: IDENTITY.podUid,
    [SCANNER_NAMESPACE_HEADER]: IDENTITY.namespace,
    [SCANNER_SCAN_ID_HEADER]: IDENTITY.scanId,
    [SCANNER_PROJECT_ID_HEADER]: IDENTITY.projectId,
  });
}

function contextOf(
  metadata: Metadata,
  request: unknown,
  call: unknown = { getPath: () => PATH, getPeer: () => 'ipv4:10.0.0.9:5000' },
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

function bindingAnswering(answer: ScannerBindingAnswer | Error): {
  binding: ScannerCallBinding;
  calls: ScannerCall[];
} {
  const calls: ScannerCall[] = [];
  return {
    calls,
    binding: {
      bind: async (call) => {
        calls.push(call);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

describe('ScannerCallGuard', () => {
  const savedMode = process.env.SCANNER_AUTH_MODE;
  const savedEdition = process.env.CYBEDEFEND_EDITION;
  let refused: jest.SpyInstance;
  let ok: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.CYBEDEFEND_EDITION;
    delete process.env.SCANNER_AUTH_MODE;
    refused = jest
      .spyOn(scannerAuthReporter(), 'refused')
      .mockImplementation(() => undefined);
    ok = jest
      .spyOn(scannerAuthReporter(), 'ok')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedMode === undefined) delete process.env.SCANNER_AUTH_MODE;
    else process.env.SCANNER_AUTH_MODE = savedMode;
    if (savedEdition === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = savedEdition;
  });

  it('lets a call without scanner identity through without calling the port', async () => {
    const { binding, calls } = bindingAnswering('not-bound');
    const guard = new ScannerCallGuard(binding);

    await expect(
      guard.canActivate(contextOf(new Metadata(), { scanId: 'scan-1' })),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(0);
    expect(refused).not.toHaveBeenCalled();
    expect(ok).not.toHaveBeenCalled();
  });

  it.each(['missing', 'invalid', 'expired'])(
    'lets a call whose token the interceptor marked %s through without calling the port',
    async (state) => {
      process.env.SCANNER_AUTH_MODE = 'enforce';
      const { binding, calls } = bindingAnswering('not-bound');
      const guard = new ScannerCallGuard(binding);

      await expect(
        guard.canActivate(
          contextOf(metadataWith({ [SCANNER_AUTH_HEADER]: state }), {}),
        ),
      ).resolves.toBe(true);
      expect(calls).toHaveLength(0);
      expect(refused).not.toHaveBeenCalled();
    },
  );

  it('binds a verified call with the full method path, the identity and the request, and counts it ok', async () => {
    const { binding, calls } = bindingAnswering('ok');
    const guard = new ScannerCallGuard(binding);
    const request = { scanId: 'scan-1', state: 'running' };

    await expect(
      guard.canActivate(contextOf(verified(), request)),
    ).resolves.toBe(true);
    expect(calls).toEqual([{ method: PATH, identity: IDENTITY, request }]);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(refused).not.toHaveBeenCalled();
  });

  it('names the method Class/handler when the call has no path', async () => {
    const { binding, calls } = bindingAnswering('ok');
    const guard = new ScannerCallGuard(binding);

    await guard.canActivate(contextOf(verified(), {}, null));
    expect(calls[0].method).toBe('ScanController/updateScan');
  });

  it('refuses an unbound call in enforce with PERMISSION_DENIED SCANNER_AUTH_NOT_BOUND', async () => {
    process.env.SCANNER_AUTH_MODE = 'enforce';
    const guard = new ScannerCallGuard(bindingAnswering('not-bound').binding);

    const error: unknown = await guard
      .canActivate(contextOf(verified(), { scanId: 'scan-2' }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual({
      code: status.PERMISSION_DENIED,
      message: SCANNER_AUTH_NOT_BOUND,
    });
    expect(refused).toHaveBeenCalledWith({
      method: PATH,
      reason: 'not-bound',
      mode: 'enforce',
      pod: IDENTITY.pod,
      scan: 'scan-2',
      peer: 'ipv4:10.0.0.9:5000',
      origin: 'guard',
    });
    expect(ok).not.toHaveBeenCalled();
  });

  it('refuses a closed container in enforce with PERMISSION_DENIED', async () => {
    process.env.SCANNER_AUTH_MODE = 'enforce';
    const guard = new ScannerCallGuard(bindingAnswering('closed').binding);

    const error = (await guard
      .canActivate(contextOf(verified(), { scanId: 'scan-1' }))
      .catch((e: unknown) => e)) as RpcException;
    expect(error.getError()).toEqual({
      code: status.PERMISSION_DENIED,
      message: SCANNER_AUTH_NOT_BOUND,
    });
  });

  it('answers a failing port as lookup-failed: UNAVAILABLE in enforce', async () => {
    process.env.SCANNER_AUTH_MODE = 'enforce';
    const guard = new ScannerCallGuard(
      bindingAnswering(new Error('db down')).binding,
    );

    const error = (await guard
      .canActivate(contextOf(verified(), { scanId: 'scan-1' }))
      .catch((e: unknown) => e)) as RpcException;
    expect(error.getError()).toEqual({
      code: status.UNAVAILABLE,
      message: SCANNER_AUTH_LOOKUP_FAILED,
    });
    expect(refused).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'lookup-failed' }),
    );
  });

  it('refuses an ok mark without the five identity headers, without calling the port', async () => {
    process.env.SCANNER_AUTH_MODE = 'enforce';
    const { binding, calls } = bindingAnswering('ok');
    const guard = new ScannerCallGuard(binding);
    const metadata = verified();
    metadata.remove(SCANNER_POD_UID_HEADER);

    const error = (await guard
      .canActivate(contextOf(metadata, {}))
      .catch((e: unknown) => e)) as RpcException;
    expect(error.getError()).toEqual({
      code: status.PERMISSION_DENIED,
      message: SCANNER_AUTH_NOT_BOUND,
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses every verified call in the Community Edition, whatever SCANNER_AUTH_MODE says', async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    process.env.SCANNER_AUTH_MODE = 'verify';
    const guard = new ScannerCallGuard(bindingAnswering('not-bound').binding);

    await expect(
      guard.canActivate(contextOf(verified(), { scanId: 'scan-1' })),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('lets a non-rpc context through', async () => {
    const { binding, calls } = bindingAnswering('not-bound');
    const guard = new ScannerCallGuard(binding);
    const context = {
      ...contextOf(verified(), {}),
      getType: () => 'http',
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('scannerIdentityOf', () => {
  it('reads the identity of a verified call', () => {
    expect(scannerIdentityOf(verified())).toEqual(IDENTITY);
  });

  it('is null without the ok mark, or with a missing identity header', () => {
    expect(scannerIdentityOf(new Metadata())).toBeNull();
    expect(scannerIdentityOf(undefined)).toBeNull();
    const marked = verified();
    marked.set(SCANNER_AUTH_HEADER, 'invalid');
    expect(scannerIdentityOf(marked)).toBeNull();
    const partial = verified();
    partial.remove(SCANNER_PROJECT_ID_HEADER);
    expect(scannerIdentityOf(partial)).toBeNull();
  });
});
