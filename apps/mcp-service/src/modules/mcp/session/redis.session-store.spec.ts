/**
 * Unit specs for `RedisSessionStore`.
 *
 * `ioredis` is mocked with a minimal in-memory fake — we only care about
 * the set/get/del/quit contract. Redis-specific behaviour (cluster, TLS,
 * retry semantics) is delegated to ioredis itself.
 */

const setMock = jest.fn(async () => 'OK');
const getMock = jest.fn(async () => null as string | null);
const delMock = jest.fn(async () => 1);
const quitMock = jest.fn(async () => 'OK');
const onMock = jest.fn();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: setMock,
    get: getMock,
    del: delMock,
    quit: quitMock,
    on: onMock,
  }));
});

// Import AFTER jest.mock so the store picks up the fake.
import { Logger } from '@nestjs/common';
import type { Session } from './session-store.interface';
import { RedisSessionStore } from './redis.session-store';
import { MAX_SESSIONS_PER_USER, TTL_MS } from './session.store';

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
    createdAt: 1000,
    lastUsed: 1000,
    ...overrides,
  };
}

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;
  const silentLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    setMock.mockClear();
    getMock.mockReset().mockResolvedValue(null);
    delMock.mockClear();
    quitMock.mockClear();
    onMock.mockClear();
    store = new RedisSessionStore('redis://localhost:6379', silentLogger);
  });

  afterEach(async () => {
    await store.stop();
  });

  it('put writes serialisable metadata to Redis with EX = TTL seconds', async () => {
    const session = makeSession({
      id: 'sid-1',
      userId: 'user-1',
      surface: 'public',
    });
    await store.put(session);

    expect(setMock).toHaveBeenCalledTimes(1);
    const args = setMock.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
    ];
    const [key, value, ex, ttl] = args;
    expect(key).toBe('mcp:session:sid-1');
    // Stored JSON must carry ONLY the serialisable envelope — never the
    // process-local `server` / `transport` objects.
    const parsed = JSON.parse(value);
    expect(parsed).toEqual({
      id: 'sid-1',
      userId: 'user-1',
      surface: 'public',
      createdAt: session.createdAt,
      lastUsed: session.lastUsed,
    });
    expect(parsed.server).toBeUndefined();
    expect(parsed.transport).toBeUndefined();
    expect(parsed.accessToken).toBeUndefined();
    expect(ex).toBe('EX');
    expect(ttl).toBe(Math.ceil(TTL_MS / 1000));
  });

  it('get returns the full locally-stored session on a local hit (and refreshes lastUsed + EX)', async () => {
    const session = makeSession({ id: 'sid-local', userId: 'u' });
    await store.put(session);
    setMock.mockClear();

    const before = session.lastUsed;
    // Nudge the clock so `lastUsed = Date.now()` is strictly greater.
    await new Promise((r) => setTimeout(r, 2));
    const retrieved = await store.get('sid-local');

    expect(retrieved).toBe(session);
    expect(retrieved!.lastUsed).toBeGreaterThan(before);
    // Redis hit-refresh: SET EX was called again to reset the TTL.
    expect(setMock).toHaveBeenCalledTimes(1);
    const refreshArgs = setMock.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
    ];
    expect(refreshArgs[2]).toBe('EX');
  });

  it('get returns undefined when Redis has the key but local does not (cross-replica)', async () => {
    // Another pod owns this session: Redis has metadata, but local Map is
    // empty. Documented MVP limitation — we force the client to reinit.
    getMock.mockResolvedValueOnce(
      JSON.stringify({
        id: 'foreign',
        userId: 'u',
        createdAt: 0,
        lastUsed: 0,
      }),
    );

    const result = await store.get('foreign');
    expect(result).toBeUndefined();
    expect(getMock).toHaveBeenCalledWith('mcp:session:foreign');
  });

  it('delete removes from Redis + local and closes transport + server', async () => {
    const serverClose = jest.fn(async () => {});
    const transportClose = jest.fn(async () => {});
    await store.put(
      makeSession({
        id: 'to-kill',
        server: { close: serverClose } as any,
        transport: { close: transportClose } as any,
      }),
    );

    await store.delete('to-kill');

    expect(delMock).toHaveBeenCalledWith('mcp:session:to-kill');
    expect(transportClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
    // Subsequent get returns undefined (local map was cleared; redis del'd).
    expect(await store.get('to-kill')).toBeUndefined();
  });

  it('delete is a no-op on locally-unknown id (still removes the Redis key)', async () => {
    await store.delete('never-existed');
    expect(delMock).toHaveBeenCalledWith('mcp:session:never-existed');
  });

  it('stop quits the Redis client', async () => {
    await store.stop();
    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it('getMetadata returns the identity envelope with surface when the session is local', async () => {
    const session = makeSession({
      id: 'local-meta',
      userId: 'user-42',
      surface: 'public',
    });
    await store.put(session);

    const meta = await store.getMetadata('local-meta');

    expect(meta).toEqual({
      id: 'local-meta',
      userId: 'user-42',
      surface: 'public',
    });
  });

  it('getMetadata returns surface from Redis when session is remote-only', async () => {
    getMock.mockResolvedValueOnce(
      JSON.stringify({
        id: 'remote-meta',
        userId: 'user-remote',
        surface: 'public',
        createdAt: 0,
        lastUsed: 0,
      }),
    );

    const meta = await store.getMetadata('remote-meta');

    expect(meta).toEqual({
      id: 'remote-meta',
      userId: 'user-remote',
      surface: 'public',
    });
    expect(getMock).toHaveBeenCalledWith('mcp:session:remote-meta');
  });

  it('getMetadata returns null when the session does not exist anywhere', async () => {
    getMock.mockResolvedValueOnce(null);

    const meta = await store.getMetadata('ghost');

    expect(meta).toBeNull();
  });

  // The MCP client name is declared once, in `initialize`. A sibling pod that
  // adopts the session never sees that request, so the name has to travel
  // with the Redis envelope or the adopted session loses it.
  describe('clientName (the MCP client declared at initialize)', () => {
    it('put stores the client name in the Redis envelope', async () => {
      await store.put(
        makeSession({ id: 'sid-client', clientName: 'claude-code' }),
      );

      const [, value] = setMock.mock.calls[0] as unknown as [string, string];
      expect(JSON.parse(value).clientName).toBe('claude-code');
    });

    it('the refresh on a local hit keeps the client name in Redis', async () => {
      await store.put(
        makeSession({ id: 'sid-refresh', clientName: 'cursor-vscode' }),
      );
      setMock.mockClear();

      await store.get('sid-refresh');

      const [, value] = setMock.mock.calls[0] as unknown as [string, string];
      expect(JSON.parse(value).clientName).toBe('cursor-vscode');
    });

    it('getMetadata returns the client name of a local session', async () => {
      await store.put(
        makeSession({ id: 'sid-local-client', clientName: 'claude-code' }),
      );

      const meta = await store.getMetadata('sid-local-client');

      expect(meta?.clientName).toBe('claude-code');
    });

    it('getMetadata returns the client name stored by another pod', async () => {
      getMock.mockResolvedValueOnce(
        JSON.stringify({
          id: 'remote-client',
          userId: 'u',
          surface: 'public',
          clientName: 'Visual Studio Code',
          createdAt: 0,
          lastUsed: 0,
        }),
      );

      const meta = await store.getMetadata('remote-client');

      expect(meta?.clientName).toBe('Visual Studio Code');
    });

    it('getMetadata drops a stored client name that is not a clean string', async () => {
      getMock.mockResolvedValueOnce(
        JSON.stringify({
          id: 'remote-bad',
          userId: 'u',
          surface: 'public',
          clientName: { name: 'claude-code' },
          createdAt: 0,
          lastUsed: 0,
        }),
      );

      const meta = await store.getMetadata('remote-bad');

      expect(meta).toEqual({
        id: 'remote-bad',
        userId: 'u',
        surface: 'public',
      });
    });
  });

  it('keeps at most MAX_SESSIONS_PER_USER local sessions per user and deletes the evicted one in Redis', async () => {
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

    expect(delMock).toHaveBeenCalledWith('mcp:session:u1-0');
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(closes[0]).toHaveBeenCalledTimes(2);
    expect(await store.getMetadata('u1-1')).not.toBeNull();
  });
});
