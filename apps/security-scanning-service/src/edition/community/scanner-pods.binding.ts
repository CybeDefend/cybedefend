import type { Provider } from '@nestjs/common';
import { SCANNER_PODS_PORT } from '../ports/scanner-pods.port';
import { CommunityScannerPods } from './scanner-pods.community';

export const SCANNER_PODS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: SCANNER_PODS_PORT, useClass: CommunityScannerPods },
];
