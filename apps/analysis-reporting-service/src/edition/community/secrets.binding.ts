import type { Provider } from '@nestjs/common';
import { SECRETS_SOURCE } from '../ports/secrets.port';
import { CommunitySecretsSource } from './secrets.community';

export const SECRETS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: SECRETS_SOURCE, useClass: CommunitySecretsSource },
];
