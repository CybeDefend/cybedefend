export interface AuthState {
  isAuthenticated: boolean;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

export interface AuthClient {
  useAuthState(): AuthState;
  getAccessToken(): Promise<string | null>;
  signIn(returnTo?: string): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Sign in through a social provider (`google`, `microsoft`, `github`,
   * `gitlab`), for a client whose sign-in offers them; absent otherwise.
   */
  signInWithProvider?(provider: string): Promise<void>;
  /**
   * Forget the session this browser keeps, with no network call (the failure
   * pages' way back to sign-in: what they escape may be the sign-in service
   * being unreachable). Absent for a client that keeps nothing.
   */
  forgetSession?(): void;
}
