// Generic: byte-identical in security-scanning-service and
// analysis-reporting-service (scripts/tests/service-auth-parity.bats).
// Change both copies together.
//
// The handler-side half of scanner-call authentication. The server
// interceptor has already checked the scanner token and, when it verifies,
// written the identity headers (after deleting any a client sent). What the
// token proves (a pod and the scan it was issued for) must still match the
// request, which only the handler sees: this guard asks the edition's call
// binding (SCANNER_CALL_BINDING), then lets the call through, or refuses it in
// enforce.
//
// - No scanner mark: not a scanner call (a signed service, a local caller),
//   the guard does nothing.
// - A mark other than `ok`: the token was missing or bad; the interceptor has
//   already counted and logged it, and in enforce answered it.
// - `ok`: the binding decides. Its refusals are counted and logged here, and
//   answered in enforce. A binding that throws counts as lookup-failed.
import { Metadata } from '@grpc/grpc-js';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

import {
  SCANNER_CALL_BINDING,
  type ScannerCallBinding,
} from '../../edition/ports/scanner-call-binding.port';
import { resolveScannerAuthMode } from '../service-auth/service-auth.edition';
import {
  SCANNER_AUTH_HEADER,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
  scannerAuthReporter,
  scannerRefusal,
  type ScannerBindingAnswer,
  type ScannerIdentity,
} from './scanner-auth.contract';

function header(metadata: Metadata | undefined, key: string): string {
  const value = metadata?.get?.(key)?.[0];
  return typeof value === 'string' ? value : '';
}

/**
 * The identity a verified scanner token proved for this call, or null when the
 * call carries none (not a scanner call, or a token that did not verify).
 * A handler uses it in place of the ids the request claims.
 */
export function scannerIdentityOf(
  metadata: Metadata | undefined,
): ScannerIdentity | null {
  if (!(metadata instanceof Metadata)) return null;
  if (header(metadata, SCANNER_AUTH_HEADER) !== 'ok') return null;
  const identity: ScannerIdentity = {
    pod: header(metadata, SCANNER_POD_HEADER),
    podUid: header(metadata, SCANNER_POD_UID_HEADER),
    namespace: header(metadata, SCANNER_NAMESPACE_HEADER),
    scanId: header(metadata, SCANNER_SCAN_ID_HEADER),
    projectId: header(metadata, SCANNER_PROJECT_ID_HEADER),
  };
  return Object.values(identity).every((value) => value !== '')
    ? identity
    : null;
}

interface CallLike {
  getPath?: () => string;
  getPeer?: () => string;
}

/** The full gRPC path when the call exposes it, else `Class/handler`. */
function methodOf(context: ExecutionContext, call: CallLike | undefined) {
  const path = call?.getPath?.();
  if (typeof path === 'string' && path !== '') return path;
  return `${context.getClass().name}/${context.getHandler().name}`;
}

function peerOf(call: CallLike | undefined): string {
  try {
    return call?.getPeer?.() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function requestScanId(request: unknown): string | undefined {
  const scanId = (request as { scanId?: unknown } | null)?.scanId;
  return typeof scanId === 'string' && scanId !== '' ? scanId : undefined;
}

@Injectable()
export class ScannerCallGuard implements CanActivate {
  constructor(
    @Inject(SCANNER_CALL_BINDING)
    private readonly binding: ScannerCallBinding,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'rpc') return true;
    const rpc = context.switchToRpc();
    const metadata = rpc.getContext<Metadata>();
    if (!(metadata instanceof Metadata)) return true;
    if (header(metadata, SCANNER_AUTH_HEADER) !== 'ok') return true;

    const request: unknown = rpc.getData();
    const call = context.getArgByIndex<CallLike | undefined>(2);
    const method = methodOf(context, call);
    const identity = scannerIdentityOf(metadata);

    let answer: ScannerBindingAnswer = 'not-bound';
    if (identity) {
      try {
        answer = await this.binding.bind({ method, identity, request });
      } catch {
        answer = 'lookup-failed';
      }
    }

    const reporter = scannerAuthReporter();
    if (answer === 'ok') {
      reporter.ok();
      return true;
    }

    const mode = resolveScannerAuthMode();
    reporter.refused({
      method,
      reason: answer,
      mode,
      pod: identity?.pod,
      scan: requestScanId(request),
      peer: peerOf(call),
      origin: 'guard',
    });
    if (mode === 'enforce') {
      const { code, details } = scannerRefusal(answer);
      throw new RpcException({ code, message: details });
    }
    return true;
  }
}
