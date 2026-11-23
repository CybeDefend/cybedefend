/* eslint-disable @typescript-eslint/no-unused-vars -- the Community
   implementation ignores its port's argument on purpose */
import type { ScannerBindingAnswer } from '../../core/scanner-auth/scanner-auth.contract';
import type {
  ScannerCall,
  ScannerCallBinding,
} from '../ports/scanner-call-binding.port';

/**
 * The Community Edition runs no scanner pod that holds a scanner token, so no
 * token can cover a call: every verified scanner call is refused. The guard
 * that asked counts and logs the refusal.
 */
export class CommunityScannerCallBinding implements ScannerCallBinding {
  async bind(_call: ScannerCall): Promise<ScannerBindingAnswer> {
    return 'not-bound';
  }
}
