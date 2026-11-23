/**
 * tokenManager — bridge between the session client and non-React code (axios
 * interceptors, SSE reconnects).
 *
 * The active edition's client registers its RAW getAccessToken here on mount
 * (in the cloud, useLogtoAuth registers the raw Logto client's, not the
 * @logto/react proxy, which swallows errors and returns undefined), with the
 * test that tells a permanent failure from a transient one. The gatewayAPI
 * 401 interceptor calls refreshAccessToken() to force a fresh token.
 *
 * Failure policy
 * --------------
 * A refresh that times out, fails on the network, waits too long for the
 * cross-tab lock or gets a 5xx is TRANSIENT: it returns null and leaves the
 * session intact so the caller simply retries later (next 401, next proactive
 * tick). Only an error the registered client calls permanent (in the cloud,
 * Logto's invalid_grant / grant_not_found) marks the session broken and
 * triggers the forced sign-in.
 *
 * The previous "3 consecutive failures ⇒ session broken" rule is gone on
 * purpose: it escalated transient failures into a redirect to the sign-in
 * provider, and when that provider was slow the redirect turned into a
 * loading loop after a long idle period.
 */

/**
 * `minValiditySeconds`: the token must still be valid that long from now,
 * refreshed first when the held one expires sooner.
 */
/**
 * `options.refusedToken`: the token the gateway just answered 401 to. A client
 * that still holds it must not hand it back from its cache (a clock or a
 * sleep may have made it look valid locally): it exchanges instead. Passed
 * only on the 401 path; a client may ignore it.
 */
export interface TokenProviderOptions {
  refusedToken?: string;
}
type GetAccessTokenFn = (
  resource?: string,
  minValiditySeconds?: number,
  options?: TokenProviderOptions,
) => Promise<string | undefined>;
type ForceSignInFn = () => void;
/** True when the error means the session is gone for good (never for a transient failure). */
export type PermanentErrorTest = (err: unknown) => boolean;

const NO_PERMANENT_ERROR: PermanentErrorTest = () => false;

/** A single provider call must settle within this budget. */
export const TOKEN_CALL_TIMEOUT_MS = 12_000;

let _getAccessToken: GetAccessTokenFn | null = null;
let _resource: string | undefined;
let _isPermanentError: PermanentErrorTest = NO_PERMANENT_ERROR;
let _refreshPromise: Promise<string | null> | null = null;
/** The refused token the in-flight refresh was asked for, if any. */
let _refreshRefused: string | undefined;
let _forceSignIn: ForceSignInFn | null = null;
let _sessionBroken = false;

/** Reject `promise` with a labelled error if it has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Called once by the session client (useLogtoAuth in the cloud) to register
 * its getAccessToken, and the test of its permanent errors: without one,
 * every failure is transient.
 */
export function registerTokenProvider(
  fn: GetAccessTokenFn,
  resource?: string,
  isPermanentError: PermanentErrorTest = NO_PERMANENT_ERROR,
): void {
  _getAccessToken = fn;
  _resource = resource;
  _isPermanentError = isPermanentError;
}

/**
 * Called by the session client (useLogtoAuth in the cloud) to register the
 * signIn callback used to send the user to sign in again when the session is
 * permanently broken.
 */
export function registerForceSignIn(fn: ForceSignInFn): void {
  _forceSignIn = fn;
}

/** Returns true when the session is permanently broken (grant gone at the provider). */
export function isSessionBroken(): boolean {
  return _sessionBroken;
}

/** Mark the session as broken and trigger forced re-login. Permanent errors only. */
export function markSessionBroken(): void {
  if (_sessionBroken) return;
  _sessionBroken = true;
  _refreshPromise = null;
  _forceSignIn?.();
}

/** Reset the breaker (called on successful token acquisition and by tests). */
export function resetCircuitBreaker(): void {
  _sessionBroken = false;
}

/**
 * One provider call, bounded and classified per the failure policy above.
 * `label` names the call in its timeout error.
 */
async function requestToken(
  provider: GetAccessTokenFn,
  label: string,
  minValiditySeconds?: number,
  refusedToken?: string,
): Promise<string | null> {
  try {
    // Inside the try: a provider that throws before returning a promise is a
    // transient failure too, never an error that escapes to the caller.
    let call: Promise<string | undefined>;
    if (refusedToken !== undefined) call = provider(_resource, minValiditySeconds, { refusedToken });
    else if (minValiditySeconds === undefined) call = provider(_resource);
    else call = provider(_resource, minValiditySeconds);
    const token = await withTimeout(
      Promise.resolve(call),
      TOKEN_CALL_TIMEOUT_MS,
      label,
    );
    if (token) {
      resetCircuitBreaker();
      return token;
    }
    return null;
  } catch (err) {
    if (_isPermanentError(err)) {
      markSessionBroken();
    } else {
      console.warn('[tokenManager] transient token refresh failure:', err);
    }
    return null;
  }
}

export interface TokenRequestOptions {
  /**
   * For a request whose bearer the server keeps using after the request
   * itself: the token must still be valid this many seconds from now.
   */
  minValiditySeconds?: number;
}

/**
 * Get a fresh JWT for non-axios callers (e.g. fetch / EventSource based SSE)
 * that cannot ride the axios interceptor. Internally identical to
 * `refreshAccessToken` — the session client returns the cached access token
 * while still valid and rotates the refresh_token automatically when expired.
 *
 * With `minValiditySeconds`, the held token is taken first (from cache while
 * it is valid), then refreshed if it expires sooner (the client's proactive
 * exchange: locked across tabs, bounded). When that refresh fails
 * transiently the caller gets the held token, already in hand: a refresh
 * blip must not fail the request, nor cost a second call and budget. A
 * permanent grant error breaks the session as everywhere else.
 */
export async function getAccessTokenForFetch(
  options: TokenRequestOptions = {},
): Promise<string | null> {
  const held = await refreshAccessToken();
  const { minValiditySeconds } = options;
  if (held === null || minValiditySeconds === undefined || !_getAccessToken) return held;
  const refreshed = await requestToken(
    _getAccessToken,
    `getAccessTokenForFetch(minValiditySeconds=${minValiditySeconds})`,
    minValiditySeconds,
  );
  if (refreshed || _sessionBroken) return refreshed;
  return held;
}

/**
 * Called by the axios 401 interceptor and the SSE reconnect path.
 * De-duplicates concurrent refresh calls so only one network request is made.
 * Returns the fresh token, or null when the refresh failed transiently.
 * A permanent grant error marks the session broken (forced sign-in).
 */
export async function refreshAccessToken(
  options: { refusedToken?: string } = {},
): Promise<string | null> {
  if (_sessionBroken) {
    _forceSignIn?.();
    return null;
  }

  if (!_getAccessToken) return null;
  const { refusedToken } = options;

  // De-duplicate: if a refresh is already in-flight, wait for it. A caller
  // whose token was refused does not take that same token back from a call
  // that was not told about it; from one that was, it takes the shared answer
  // (asking again would cost one call per concurrent 401).
  if (_refreshPromise) {
    const sharedFor = _refreshRefused;
    const shared = await _refreshPromise;
    if (refusedToken === undefined || shared !== refusedToken || sharedFor === refusedToken) return shared;
    return refreshAccessToken(options);
  }

  _refreshRefused = refusedToken;
  _refreshPromise = requestToken(_getAccessToken, 'refreshAccessToken', undefined, refusedToken).finally(() => {
    _refreshPromise = null;
    _refreshRefused = undefined;
  });

  return _refreshPromise;
}
