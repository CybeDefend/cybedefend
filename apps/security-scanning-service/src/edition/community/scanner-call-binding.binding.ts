import type { Provider } from '@nestjs/common';
import { SCANNER_CALL_BINDING } from '../ports/scanner-call-binding.port';
import { CommunityScannerCallBinding } from './scanner-call-binding.community';

export const SCANNER_CALL_COMMUNITY_BINDINGS: Provider[] = [
  { provide: SCANNER_CALL_BINDING, useClass: CommunityScannerCallBinding },
];
