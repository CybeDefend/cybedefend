import type { Provider } from '@nestjs/common';
import { ENTITLEMENTS_PORT } from '../ports/entitlements.port';
import { CommunityEntitlements } from './entitlements.community';

export const ENTITLEMENTS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: ENTITLEMENTS_PORT, useClass: CommunityEntitlements },
];
