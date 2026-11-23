import { ACTIVE_EE_AUTH_CLIENT } from '@/edition/active';
import type { AuthClient } from './authClient';
import { communityAuthClient } from './community/communityAuthClient';

export { communityAuthClient };

/** The session client of the active edition: the closed tree's when it is active, the Community one otherwise. */
export const authClient: AuthClient = ACTIVE_EE_AUTH_CLIENT ?? communityAuthClient;

export interface UseAuthResult {
  isAuthenticated: boolean;
  loading: boolean;
  authError: Error | null;
  retryAuth(): void;
}

/** The session as App and the pages read it. */
export function useAuth(): UseAuthResult {
  const { isAuthenticated, loading, error, retry } = authClient.useAuthState();
  return { isAuthenticated, loading, authError: error, retryAuth: retry };
}
