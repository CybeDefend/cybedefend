import { Injectable } from '@nestjs/common';
import type { ScannerBindingAnswer } from '../../core/scanner-auth/scanner-auth.contract';
import type { ScannerCallBinding } from '../ports/scanner-call-binding.port';

/**
 * The Community Edition admits no scanner token: its scanners run with the
 * deployment's own service credentials. A call that still reaches the binding
 * is never bound; the guard reports it, and refuses it in enforce.
 */
@Injectable()
export class CommunityScannerCallBinding implements ScannerCallBinding {
  async bind(): Promise<ScannerBindingAnswer> {
    return 'not-bound';
  }
}
