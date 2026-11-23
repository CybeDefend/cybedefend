export const BEARER_VERIFIER = 'BEARER_VERIFIER';

export type BearerRejection = 'missing_bearer' | 'invalid_token';

export interface VerifiedBearer {
  userId: string;
  accessToken: string;
}

export interface BearerVerifier {
  /** null → 401 invalid_token. */
  verify(token: string): Promise<VerifiedBearer | null>;
  /** The WWW-Authenticate header value. */
  challenge(reason: BearerRejection): string;
}
