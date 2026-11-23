import type { Provider } from '@nestjs/common';
import { PersonalAccessTokenStore } from 'src/modules/local-auth/personal-access-token.store';
import { RefreshTokenStore } from 'src/modules/local-auth/refresh-token.store';
import { IDENTITY_PROVIDER_PORT } from '../ports/identity-provider.port';
import { CommunityIdentityProvider } from './identity-provider.community';

export const IDENTITY_PROVIDER_COMMUNITY_BINDINGS: Provider[] = [
  // The local stores the community identity provider delegates to: the PATs,
  // and the refresh sessions a removed member loses.
  PersonalAccessTokenStore,
  RefreshTokenStore,
  { provide: IDENTITY_PROVIDER_PORT, useClass: CommunityIdentityProvider },
];
