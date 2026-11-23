import type {
  ScannerBindingAnswer,
  ScannerIdentity,
} from '../../core/scanner-auth/scanner-auth.contract';

/**
 * Edition port: whether a verified scanner token covers the call it came
 * with. The identity is what the token proves (its pod and the scan it was
 * issued for); the request is the call's decoded message. The answer is ok,
 * or why the token does not cover it (ScannerBindingAnswer).
 */
export const SCANNER_CALL_BINDING = 'SCANNER_CALL_BINDING';

export interface ScannerCall {
  /** The full method path, `/package.Service/Method`. */
  readonly method: string;
  readonly identity: ScannerIdentity;
  readonly request: unknown;
}

export interface ScannerCallBinding {
  bind(call: ScannerCall): Promise<ScannerBindingAnswer>;
}
