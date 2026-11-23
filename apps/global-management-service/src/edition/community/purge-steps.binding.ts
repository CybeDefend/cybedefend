import type { Provider } from '@nestjs/common';
import { PURGE_STEPS } from '../ports/purge-steps.port';
import { CommunityPurgeSteps } from './purge-steps.community';

export const PURGE_STEPS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: PURGE_STEPS, useClass: CommunityPurgeSteps },
];
