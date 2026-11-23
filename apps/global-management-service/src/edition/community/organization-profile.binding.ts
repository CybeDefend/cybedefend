import type { Provider } from '@nestjs/common';
import { ORGANIZATION_PROFILE_PORT } from '../ports/organization-profile.port';
import { CommunityOrganizationProfile } from './organization-profile.community';

export const ORGANIZATION_PROFILE_COMMUNITY_BINDINGS: Provider[] = [
  {
    provide: ORGANIZATION_PROFILE_PORT,
    useClass: CommunityOrganizationProfile,
  },
];
