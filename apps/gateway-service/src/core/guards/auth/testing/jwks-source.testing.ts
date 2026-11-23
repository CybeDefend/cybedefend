import { Global, Module } from '@nestjs/common';
import type { JWTVerifyGetKey } from 'jose';
import {
  JWKS_SOURCE,
  type AuthenticatedUser,
  type JwksSource,
  type JwtExpectations,
} from 'src/edition/ports/jwks-source.port';

/**
 * Test double for JWKS_SOURCE: warms up nothing, verifies no token and
 * answers every personal access token as unknown. Specs replace
 * `keyResolver`, `expectations` or `verifyPersonalAccessToken` with their own
 * fakes (e.g. `jest.spyOn(source, 'verifyPersonalAccessToken')`).
 */
export class FakeJwksSource implements JwksSource {
  async init(): Promise<void> {
    // No warm-up in tests.
  }

  expectations(): JwtExpectations {
    return { issuer: 'https://issuer.test', audience: 'audience.test' };
  }

  keyResolver(): JWTVerifyGetKey {
    return () => {
      throw new Error('FakeJwksSource.keyResolver: no key configured');
    };
  }

  async verifyPersonalAccessToken(
    _token: string,
  ): Promise<AuthenticatedUser | null> {
    return null;
  }
}

/**
 * Provides a `FakeJwksSource` for specs that compile a module holding
 * `AuthGuard` (the port token otherwise resolves only through the global
 * EditionModule, which production AppModule imports).
 */
@Global()
@Module({
  providers: [{ provide: JWKS_SOURCE, useClass: FakeJwksSource }],
  exports: [JWKS_SOURCE],
})
export class JwksSourceTestingModule {}
