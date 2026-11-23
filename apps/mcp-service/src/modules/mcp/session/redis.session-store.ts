import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

import type {
  Session,
  SessionMetadata,
  SessionStore,
  SessionSurface,
} from './session-store.interface';
import { sessionsOverCap, SWEEP_MS, TTL_MS } from './session.store';
import { sanitizeClientName } from '../shared/client-name';

/**
 * Only the serialisable fields of a `Session` live in Redis. The
 * `Server`/`transport` pair is process-local (MCP SDK objects hold streams,
 * event loops, and other non-portable state) and would be meaningless on a
 * sibling pod.
 *
 * `surface` and `clientName` follow the session across pods so an adopting
 * replica can rebuild the same tool context. Authorisation no longer travels
 * with the session — MCP tools forward to Gateway which point-checks Permify.
 */
export interface RedisSessionMetadata {
  id: string;
  userId: string;
  surface: SessionSurface;
  clientName?: string;
  createdAt: number;
  lastUsed: number;
}

/**
 * Redis key namespace. Scoped with a prefix so the session bucket can share
 * a Redis instance with other subsystems without collisions.
 */
const KEY_PREFIX = 'mcp:session:';
const ttlSeconds = Math.ceil(TTL_MS / 1000);

/**
 * Multi-replica session store.
 *
 * Design:
 *  - Local `Map<id, Session>` holds the full Session (incl. `server` and
 *    `transport`) — these cannot be serialised, so they stay where the
 *    SDK's event loop lives.
 *  - Redis holds ONLY the metadata envelope (`id`, `userId`, timestamps)
 *    with `EX = TTL_MS / 1000`. This lets a sibling replica *see* that a
 *    session id exists somewhere in the fleet.
 *  - On `get(id)`, a local hit returns the full Session (and bumps `lastUsed`
 *    on both layers). A local miss + Redis hit returns `undefined` — the
 *    caller (`McpController.handle`) uses `getMetadata()` separately to
 *    decide whether to adopt the session.
 *  - On `getMetadata(id)`, returns `{ id, userId }` from local map or Redis.
 *    Returns null if the session does not exist anywhere.
 *
 * The local TTL sweeper mirrors `InMemorySessionStore` so orphaned
 * `server`/`transport` pairs don't leak when Redis's EX expires silently.
 */
export class RedisSessionStore implements SessionStore {
  private readonly local = new Map<string, Session>();
  private readonly redis: Redis;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    redisUrl: string,
    private readonly log: Logger = new Logger(RedisSessionStore.name),
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
    });
    this.redis.on('error', (err) => {
      this.log.warn(`Redis error: ${err.message}`);
    });

    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
    this.sweeper.unref();
  }

  async put(session: Session): Promise<void> {
    this.local.set(session.id, session);
    const meta: RedisSessionMetadata = {
      id: session.id,
      userId: session.userId,
      surface: session.surface,
      clientName: session.clientName,
      createdAt: session.createdAt,
      lastUsed: session.lastUsed,
    };
    await this.redis.set(
      KEY_PREFIX + session.id,
      JSON.stringify(meta),
      'EX',
      ttlSeconds,
    );
    for (const id of sessionsOverCap(
      this.local.values(),
      session.userId,
      session.id,
    )) {
      this.log.debug(`Ending session ${id}: per-user session cap reached`);
      await this.delete(id);
    }
  }

  async get(id: string): Promise<Session | undefined> {
    const local = this.local.get(id);
    if (local) {
      local.lastUsed = Date.now();
      const meta: RedisSessionMetadata = {
        id: local.id,
        userId: local.userId,
        surface: local.surface,
        clientName: local.clientName,
        createdAt: local.createdAt,
        lastUsed: local.lastUsed,
      };
      await this.redis.set(
        KEY_PREFIX + id,
        JSON.stringify(meta),
        'EX',
        ttlSeconds,
      );
      return local;
    }

    const raw = await this.redis.get(KEY_PREFIX + id);
    if (raw) {
      this.log.debug(
        `Session ${id} exists in Redis but not on this replica — use getMetadata() to adopt`,
      );
    }
    return undefined;
  }

  async getMetadata(id: string): Promise<SessionMetadata | null> {
    const local = this.local.get(id);
    if (local) {
      return {
        id: local.id,
        userId: local.userId,
        surface: local.surface,
        clientName: local.clientName,
      };
    }

    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) return null;
    const meta: RedisSessionMetadata = JSON.parse(raw) as RedisSessionMetadata;
    // Sanitised again on the way out: whatever sits in Redis ends up in a
    // Gateway request body, so it gets no more trust than the original
    // `initialize` request did.
    const clientName = sanitizeClientName(meta.clientName);
    return {
      id: meta.id,
      userId: meta.userId,
      surface: meta.surface,
      ...(clientName ? { clientName } : {}),
    };
  }

  async delete(id: string): Promise<void> {
    const local = this.local.get(id);
    await this.redis.del(KEY_PREFIX + id);
    if (!local) return;
    this.local.delete(id);
    try {
      await local.transport.close();
    } catch {
      /* noop */
    }
    try {
      await local.server.close();
    } catch {
      /* noop */
    }
  }

  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    try {
      await this.redis.quit();
    } catch {
      /* noop */
    }
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of this.local) {
      if (now - s.lastUsed > TTL_MS) {
        this.log.debug(`Evicting idle session ${id}`);
        await this.delete(id);
      }
    }
  }
}
