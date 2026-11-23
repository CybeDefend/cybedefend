import type { JWTVerifyGetKey } from 'jose';

/**
 * The JWKS source port. The core `AuthGuard` asks the edition
 * layer where the bearer's keys come from and what a token must carry: the
 * cloud answers with Logto's OIDC set, the Community Edition with the local
 * signing key published by global-management's `GetJwks`.
 */
export const JWKS_SOURCE = 'JWKS_SOURCE';

export interface JwtExpectations {
  issuer: string;
  audience: string;
  /** When set, the only signature algorithms accepted (jose `algorithms`). */
  algorithms?: string[];
}

export interface AuthenticatedUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * What AuthGuard puts on request.user: `via` says how the bearer was
 * verified, so a route can refuse a personal access token.
 */
export type RequestUser = AuthenticatedUser & { via: 'jwt' | 'pat' };

export interface JwksSource {
  /** Warm-up, memoised: several AuthGuard instances call it; never throws. */
  init(): Promise<void>;
  expectations(): JwtExpectations;
  keyResolver(): JWTVerifyGetKey;
  /**
   * null: this edition has no personal access tokens of its own; the token
   * goes to JWT verification.
   */
  verifyPersonalAccessToken(token: string): Promise<AuthenticatedUser | null>;
}
