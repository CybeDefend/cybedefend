import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAccessTokenForFetch,
  refreshAccessToken,
  registerForceSignIn,
  registerTokenProvider,
  resetCircuitBreaker,
  isSessionBroken,
  markSessionBroken,
  TOKEN_CALL_TIMEOUT_MS,
} from './tokenManager';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('tokenManager.getAccessTokenForFetch', () => {
  beforeEach(() => {
    resetCircuitBreaker();
    registerForceSignIn(() => {});
    registerTokenProvider(async () => undefined, undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fresh JWT delivered by the registered provider', async () => {
    const provider = vi.fn(async () => 'jwt-logto-1');
    registerTokenProvider(provider, 'cybe-api');

    const token = await getAccessTokenForFetch();

    expect(token).toBe('jwt-logto-1');
    expect(provider).toHaveBeenCalledWith('cybe-api');
  });

  it('returns null when the provider yields undefined and leaves the session intact', async () => {
    const provider = vi.fn(async () => undefined);
    registerTokenProvider(provider, undefined);

    await expect(getAccessTokenForFetch()).resolves.toBeNull();
    await expect(getAccessTokenForFetch()).resolves.toBeNull();
    await expect(getAccessTokenForFetch()).resolves.toBeNull();
    await expect(getAccessTokenForFetch()).resolves.toBeNull();

    expect(isSessionBroken()).toBe(false);
  });

  it('returns null and never calls the provider once the session is broken', async () => {
    const provider = vi.fn(async () => 'jwt-logto-1');
    registerTokenProvider(provider, undefined);
    markSessionBroken();
    expect(isSessionBroken()).toBe(true);

    const token = await getAccessTokenForFetch();

    expect(token).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it('de-duplicates concurrent calls into a single provider invocation', async () => {
    let resolveFn: (value: string) => void = () => {
      /* set by the provider lambda */
    };
    const provider = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolveFn = res;
        }),
    );
    registerTokenProvider(provider, undefined);

    const a = getAccessTokenForFetch();
    const b = getAccessTokenForFetch();
    await flushMicrotasks();
    expect(provider).toHaveBeenCalledTimes(1);
    resolveFn('jwt-logto-2');

    await expect(a).resolves.toBe('jwt-logto-2');
    await expect(b).resolves.toBe('jwt-logto-2');
  });

  it('treats a provider that throws synchronously as a transient failure, on every call shape', async () => {
    const forceSignIn = vi.fn();
    registerForceSignIn(forceSignIn);
    const provider = vi.fn((): Promise<string | undefined> => {
      throw new Error('provider exploded before returning a promise');
    });
    registerTokenProvider(provider, undefined);

    await expect(refreshAccessToken()).resolves.toBeNull();
    await expect(refreshAccessToken({ refusedToken: 'T' })).resolves.toBeNull();
    await expect(getAccessTokenForFetch({ minValiditySeconds: 60 })).resolves.toBeNull();

    expect(provider).toHaveBeenCalledTimes(3);
    expect(isSessionBroken()).toBe(false);
    expect(forceSignIn).not.toHaveBeenCalled();
  });

  it('never breaks the session on repeated transient failures', async () => {
    const forceSignIn = vi.fn();
    registerForceSignIn(forceSignIn);
    const provider = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    registerTokenProvider(provider, undefined);

    for (let i = 0; i < 5; i += 1) {
      await expect(refreshAccessToken()).resolves.toBeNull();
    }

    expect(isSessionBroken()).toBe(false);
    expect(forceSignIn).not.toHaveBeenCalled();
  });

  it('bounds a provider that never settles and stays transient', async () => {
    vi.useFakeTimers();
    const forceSignIn = vi.fn();
    registerForceSignIn(forceSignIn);
    registerTokenProvider(() => new Promise<string>(() => { /* never */ }), undefined);

    const pending = refreshAccessToken();
    await vi.advanceTimersByTimeAsync(TOKEN_CALL_TIMEOUT_MS);

    await expect(pending).resolves.toBeNull();
    expect(isSessionBroken()).toBe(false);
    expect(forceSignIn).not.toHaveBeenCalled();
  });

  it('breaks the session on an error the registered provider calls permanent', async () => {
    const forceSignIn = vi.fn();
    registerForceSignIn(forceSignIn);
    registerTokenProvider(
      async () => {
        throw new Error('grant gone');
      },
      undefined,
      (err) => err instanceof Error && err.message === 'grant gone',
    );

    await expect(refreshAccessToken()).resolves.toBeNull();

    expect(isSessionBroken()).toBe(true);
    expect(forceSignIn).toHaveBeenCalledTimes(1);
  });

  it('treats every failure as transient when the provider names no permanent error', async () => {
    const forceSignIn = vi.fn();
    registerForceSignIn(forceSignIn);
    registerTokenProvider(async () => {
      throw new Error('invalid_grant: session expired');
    }, undefined);

    await expect(refreshAccessToken()).resolves.toBeNull();

    expect(isSessionBroken()).toBe(false);
    expect(forceSignIn).not.toHaveBeenCalled();
  });
});

describe('tokenManager.getAccessTokenForFetch with a minimum validity', () => {
  // Stands in for the raw Logto client: asked for a minimum validity it runs
  // the proactive exchange, otherwise it hands back the token it holds.
  const HELD = 'jwt-held-expires-in-90s';
  const REFRESHED = 'jwt-refreshed-outlives-the-turn';

  beforeEach(() => {
    resetCircuitBreaker();
    registerForceSignIn(() => {});
  });

  afterEach(async () => {
    // Let every bounded call time out so no pending refresh leaks into the next test.
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(2 * TOKEN_CALL_TIMEOUT_MS);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks the provider for a token that stays valid that long', async () => {
    const provider = vi.fn(async (_resource?: string, minValiditySeconds?: number) =>
      minValiditySeconds === 300 ? REFRESHED : HELD,
    );
    registerTokenProvider(provider, 'cybe-api');

    await expect(getAccessTokenForFetch({ minValiditySeconds: 300 })).resolves.toBe(REFRESHED);
    expect(provider).toHaveBeenCalledWith('cybe-api', 300);
  });

  it('falls back to the held token, session intact, when the forced refresh fails transiently', async () => {
    const forceSignIn = vi.fn();
    registerForceSignIn(forceSignIn);
    const provider = vi.fn(async (_resource?: string, minValiditySeconds?: number) => {
      if (minValiditySeconds !== undefined) throw new Error('Failed to fetch');
      return HELD;
    });
    registerTokenProvider(provider, 'cybe-api');

    await expect(getAccessTokenForFetch({ minValiditySeconds: 300 })).resolves.toBe(HELD);
    // The held token is in hand before the forced refresh: its failure costs no further call.
    expect(provider.mock.calls).toEqual([['cybe-api'], ['cybe-api', 300]]);
    expect(isSessionBroken()).toBe(false);
    expect(forceSignIn).not.toHaveBeenCalled();
  });

  it('waits on a hung forced refresh only for the existing call budget, then falls back', async () => {
    vi.useFakeTimers();
    registerTokenProvider(
      (_resource?: string, minValiditySeconds?: number) =>
        minValiditySeconds !== undefined
          ? new Promise<string>(() => { /* Logto never answers */ })
          : Promise.resolve(HELD),
      'cybe-api',
    );

    let settled: string | null | undefined;
    const pending = getAccessTokenForFetch({ minValiditySeconds: 300 });
    void pending.then((token) => {
      settled = token;
    });

    await vi.advanceTimersByTimeAsync(TOKEN_CALL_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(HELD);
    expect(isSessionBroken()).toBe(false);
  });

  it('gives up after one call budget when Logto hangs and the held token has expired', async () => {
    vi.useFakeTimers();
    // An expired held token makes the plain call exchange too, and Logto never answers.
    const provider = vi.fn(
      (_resource?: string, _minValiditySeconds?: number) =>
        new Promise<string>(() => { /* Logto never answers */ }),
    );
    registerTokenProvider(provider, 'cybe-api');

    let settled: string | null | undefined;
    void getAccessTokenForFetch({ minValiditySeconds: 300 }).then((token) => {
      settled = token;
    });

    await vi.advanceTimersByTimeAsync(TOKEN_CALL_TIMEOUT_MS);
    expect(settled).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('names the forced refresh, not refreshAccessToken, when it stalls', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTokenProvider(
      (_resource?: string, minValiditySeconds?: number) =>
        minValiditySeconds !== undefined
          ? new Promise<string>(() => { /* Logto never answers */ })
          : Promise.resolve(HELD),
      'cybe-api',
    );

    const pending = getAccessTokenForFetch({ minValiditySeconds: 300 });
    await vi.advanceTimersByTimeAsync(TOKEN_CALL_TIMEOUT_MS);
    await pending;

    const logged = warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('minValiditySeconds=300');
    expect(logged).not.toContain('refreshAccessToken');
  });

  it('never calls the provider once the session is broken', async () => {
    const provider = vi.fn(async () => REFRESHED);
    registerTokenProvider(provider, 'cybe-api');
    markSessionBroken();

    await expect(getAccessTokenForFetch({ minValiditySeconds: 300 })).resolves.toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('tokenManager.refreshAccessToken after a 401 (the refused token)', () => {
  beforeEach(() => {
    resetCircuitBreaker();
    registerForceSignIn(() => {});
  });

  it('hands the provider the token the gateway refused', async () => {
    const provider = vi.fn(async () => 'jwt-new');
    registerTokenProvider(provider, 'cybe-api');
    await expect(refreshAccessToken({ refusedToken: 'jwt-refused' })).resolves.toBe('jwt-new');
    expect(provider.mock.calls).toEqual([['cybe-api', undefined, { refusedToken: 'jwt-refused' }]]);
  });

  it('without a refused token the provider is called as before', async () => {
    const provider = vi.fn(async () => 'jwt-held');
    registerTokenProvider(provider, 'cybe-api');
    await refreshAccessToken();
    expect(provider.mock.calls).toEqual([['cybe-api']]);
  });

  it('a call for a refused token that joined one answering that same token asks again', async () => {
    let release!: () => void;
    const provider = vi.fn(
      (_r?: string, _m?: number, options?: { refusedToken?: string }) =>
        options?.refusedToken
          ? Promise.resolve('jwt-new')
          : new Promise<string>((resolve) => {
              release = () => resolve('jwt-refused');
            }),
    );
    registerTokenProvider(provider, 'cybe-api');
    const plain = refreshAccessToken();
    const forced = refreshAccessToken({ refusedToken: 'jwt-refused' });
    release();
    await expect(plain).resolves.toBe('jwt-refused');
    await expect(forced).resolves.toBe('jwt-new');
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('tokenManager.refreshAccessToken: concurrent 401s sharing one refused token', () => {
  beforeEach(() => {
    resetCircuitBreaker();
    registerForceSignIn(() => {});
  });

  it('5 concurrent calls for the same refused token make one provider call and share its answer', async () => {
    let release!: () => void;
    const provider = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('T');
        }),
    );
    registerTokenProvider(provider, 'cybe-api');
    const calls = Array.from({ length: 5 }, () => refreshAccessToken({ refusedToken: 'T' }));
    await flushMicrotasks();
    release();
    await expect(Promise.all(calls)).resolves.toEqual(['T', 'T', 'T', 'T', 'T']);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
