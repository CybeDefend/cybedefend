import type { Provider } from '@nestjs/common';
import { BEARER_VERIFIER } from '../ports/bearer-verifier.port';
import { PersonalAccessTokenBearerVerifier } from './bearer-verifier.community';

export const BEARER_VERIFIER_COMMUNITY_BINDINGS: Provider[] = [
  { provide: BEARER_VERIFIER, useClass: PersonalAccessTokenBearerVerifier },
];
