import type { Provider } from '@nestjs/common';
import {
  SCAN_COMPLETED_LISTENERS,
  type ScanCompletedListener,
} from '../ports/scan-completed-listeners.port';

const NO_LISTENERS: ScanCompletedListener[] = [];

export const SCAN_COMPLETED_LISTENERS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: SCAN_COMPLETED_LISTENERS, useValue: NO_LISTENERS },
];
