import * as permify from '@permify/permify-node';

/**
 * The one way this service builds a Permify client. Permify runs with
 * preshared-key authentication: without the key, any process that reaches
 * its port could write relationships and grant itself any role. Every call
 * carries `authorization: Bearer <key>`.
 *
 * The key is read on every call, not when the client is built: a provider
 * constructed before the secrets are loaded still sends it. While no key is
 * configured the call goes out without one, which a Permify that does not
 * enforce authentication accepts and one that does refuses (fail closed).
 *
 * Generic file: the same bytes in every service that talks to Permify.
 */

export type PermifyClient = ReturnType<typeof permify.grpc.newClient>;
export type PermifyClientMiddleware = ReturnType<
  typeof permify.grpc.newAccessTokenInterceptor
>;

/** The variable, and the secret, that hold the Permify preshared key. */
export const PERMIFY_PRESHARED_KEY = 'PERMIFY_PRESHARED_KEY';

export function permifyPresharedKeyInterceptor(
  readKey: () => string | undefined,
): PermifyClientMiddleware {
  return async function* (call, options) {
    const key = readKey()?.trim();
    if (!key) {
      return yield* call.next(call.request, options);
    }
    return yield* permify.grpc.newAccessTokenInterceptor(key)(call, options);
  };
}

/** Process-wide: one warning, whatever the number of clients built. */
let presharedKeyWarned = false;

/**
 * Says once, at boot, that Permify is configured (an endpoint is set) but no
 * preshared key resolves: every call then goes out without one, which a
 * Permify that enforces authentication refuses. The calls still fail closed;
 * this only makes the cause visible. Names the variable, never a value.
 * Returns whether it warned. Call it after the secrets are loaded.
 */
export function warnOnceIfPermifyPresharedKeyMissing(
  endpoint: string | undefined,
  readKey: () => string | undefined,
  warn: (message: string) => void,
): boolean {
  if (presharedKeyWarned) return false;
  if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
  if (readKey()?.trim()) return false;
  presharedKeyWarned = true;
  warn(
    `PERMIFY_PRESHARED_KEY_MISSING: Permify is configured but ${PERMIFY_PRESHARED_KEY} is not set; calls go out without a key and an authenticating Permify refuses them`,
  );
  return true;
}

/** Forget the boot warning (unit tests). */
export function resetPermifyPresharedKeyWarning(): void {
  presharedKeyWarned = false;
}

export function createPermifyClient(
  endpoint: string,
  readKey: () => string | undefined,
): PermifyClient {
  return permify.grpc.newClient(
    {
      endpoint,
      cert: null,
      insecure: true,
      pk: null,
      certChain: null,
    },
    permifyPresharedKeyInterceptor(readKey),
  );
}
