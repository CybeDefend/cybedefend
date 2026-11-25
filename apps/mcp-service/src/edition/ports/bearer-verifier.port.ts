export const BEARER_VERIFIER = 'BEARER_VERIFIER';

export type BearerRejection = 'missing_bearer' | 'invalid_token';

export interface VerifiedBearer {
  userId: string;
  accessToken: string;
  /**
   * The person the bearer belongs to, when the verifier knows it and it is
   * not `userId` (a personal access token's `userId` names the token). Keys
   * the per-person request budget, so a person's tokens share one budget.
   */
  subject?: string;
}

export interface BearerVerifier {
  /**
   * True when verifying a bearer costs a call to another service (for each
   * bearer the verifier has not cached), false or absent when it is a local
   * check. The request guards bound the bearers a remote verifier refuses,
   * per client address; a local verifier's refusals are counted nowhere.
   */
  readonly remote?: boolean;
  /** null → 401 invalid_token. */
  verify(token: string): Promise<VerifiedBearer | null>;
  /** The WWW-Authenticate header value. */
  challenge(reason: BearerRejection): string;
}
