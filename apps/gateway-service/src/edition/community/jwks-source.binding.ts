import type { Provider } from '@nestjs/common';
import { JWKS_SOURCE } from '../ports/jwks-source.port';
import { LocalJwksSource } from './jwks-source.community';

export const JWKS_SOURCE_COMMUNITY_BINDINGS: Provider[] = [
  { provide: JWKS_SOURCE, useClass: LocalJwksSource },
];
