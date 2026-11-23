import type { Provider } from '@nestjs/common';
import { SCAN_LIFECYCLE_HOOKS } from '../ports/scan-lifecycle-hooks.port';
import { CommunityScanLifecycleHooks } from './scan-lifecycle-hooks.community';

export const SCAN_LIFECYCLE_HOOKS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: SCAN_LIFECYCLE_HOOKS, useClass: CommunityScanLifecycleHooks },
];
