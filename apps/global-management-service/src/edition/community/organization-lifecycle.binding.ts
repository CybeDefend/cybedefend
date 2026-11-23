import type { Provider } from '@nestjs/common';
import { ORGANIZATION_LIFECYCLE_HOOKS } from '../ports/organization-lifecycle.port';
import { CommunityOrganizationLifecycle } from './organization-lifecycle.community';

export const ORGANIZATION_LIFECYCLE_COMMUNITY_BINDINGS: Provider[] = [
  {
    provide: ORGANIZATION_LIFECYCLE_HOOKS,
    useClass: CommunityOrganizationLifecycle,
  },
];
