import {
  InMemorySessionStore,
  MAX_SESSIONS_PER_USER,
  Session,
  TTL_MS,
  SWEEP_MS,
} from './session.store';

function makeSession(overrides: Partial<Session> = {}): Session {
  const close = jest.fn(async () => {});
  return {
    id: 'abc',
    userId: 'u1',
    accessToken: 't',
    accessTokenRef: { current: 't' },

    server: { close } as any,

    transport: { close } as any,
    surface: 'public',
    createdAt: Date.now(),
    lastUsed: Date.now(),
    ...overrides,
  };
}

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  afterEach(() => {
    store?.stop();
    jest.useRealTimers();
  });

  it('stores and retrieves a session', () => {
    store = new InMemorySessionStore();
    const s = makeSession({ id: 'abc', userId: 'u1' });
    store.put(s);
    expect((store.get('abc') as Session)?.userId).toBe('u1');
  });

  it('returns undefined for unknown id', () => {
    store = new InMemorySessionStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('updates lastUsed on get', async () => {
    store = new InMemorySessionStore();
    const s = makeSession({ id: 'a', createdAt: 0, lastUsed: 0 });
    store.put(s);
    const before = s.lastUsed;
    // Wait a tick to ensure the clock advances past `before` (ms resolution).
    await new Promise((r) => setTimeout(r, 2));
    const retrieved = store.get('a') as Session;
    expect(retrieved!.lastUsed).toBeGreaterThan(before);
  });

  it('delete closes transport and server then removes entry', async () => {
    store = new InMemorySessionStore();
    const close = jest.fn(async () => {});
    store.put(
      makeSession({
        id: 'x',

        server: { close } as any,

        transport: { close } as any,
      }),
    );
    await store.delete('x');
    expect(store.get('x')).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2); // server + transport
  });

  it('sweeps idle sessions older than TTL', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const now = 1_000_000;
    jest.setSystemTime(now);

    store = new InMemorySessionStore();
    const close = jest.fn(async () => {});
    store.put(
      makeSession({
        id: 'stale',
        createdAt: now,
        lastUsed: now,

        server: { close } as any,

        transport: { close } as any,
      }),
    );
    expect(store.get('stale')).toBeDefined();
    // Do NOT re-`get` after this (it would refresh `lastUsed`). Advance clock
    // past TTL so the next sweep tick considers this session expired.
    jest.setSystemTime(now + TTL_MS + 1_000);
    // Fire the next sweeper interval.
    jest.advanceTimersByTime(SWEEP_MS);
    // Let the async sweep body resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(store['sessions'].has('stale')).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  it('getMetadata returns identity envelope with surface for a stored session', async () => {
    store = new InMemorySessionStore();
    const s = makeSession({
      id: 'meta-id',
      userId: 'meta-user',
      surface: 'public',
    });
    store.put(s);

    const meta = await store.getMetadata('meta-id');

    expect(meta).toEqual({
      id: 'meta-id',
      userId: 'meta-user',
      surface: 'public',
    });
  });

  it('getMetadata returns null for an unknown session id', async () => {
    store = new InMemorySessionStore();

    const meta = await store.getMetadata('nope');

    expect(meta).toBeNull();
  });

  it('getMetadata returns the MCP client name declared at initialize', async () => {
    store = new InMemorySessionStore();
    store.put(makeSession({ id: 'client-id', clientName: 'claude-code' }));

    const meta = await store.getMetadata('client-id');

    expect(meta?.clientName).toBe('claude-code');
  });

  it('keeps at most MAX_SESSIONS_PER_USER sessions per user, ending the least recently used', async () => {
    store = new InMemorySessionStore();
    const closes: jest.Mock[] = [];
    for (let i = 0; i <= MAX_SESSIONS_PER_USER; i++) {
      const close = jest.fn(async () => {});
      closes.push(close);
      await store.put(
        makeSession({
          id: `u1-${i}`,
          userId: 'u1',
          lastUsed: 1000 + i,
          server: { close } as any,
          transport: { close } as any,
        }),
      );
    }
    await store.put(makeSession({ id: 'u2-0', userId: 'u2' }));

    expect(store.get('u1-0')).toBeUndefined();
    expect(closes[0]).toHaveBeenCalledTimes(2);
    for (let i = 1; i <= MAX_SESSIONS_PER_USER; i++) {
      expect(store.get(`u1-${i}`)).toBeDefined();
    }
    expect(store.get('u2-0')).toBeDefined();
  });

  it('does not count a session put again under the same id', async () => {
    store = new InMemorySessionStore();
    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
      await store.put(makeSession({ id: `s-${i}`, lastUsed: 1000 + i }));
    }
    await store.put(makeSession({ id: 's-3', lastUsed: 5000 }));

    for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
      expect(store.get(`s-${i}`)).toBeDefined();
    }
  });
});
