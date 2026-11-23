import { Injectable, Logger } from '@nestjs/common';

import type {
  Session,
  SessionStore,
  SessionMetadata,
} from './session-store.interface';

// Re-export so existing imports of `Session` from `./session.store` keep
// working. New code should import from `./session-store.interface`.
export type { Session, SessionStore } from './session-store.interface';
export { SESSION_STORE } from './session-store.interface';

/**
 * Idle-TTL after which a session is evicted by the periodic sweeper.
 * Matches the 30-minute window the plan specifies.
 */
export const TTL_MS = 30 * 60_000;

/**
 * Interval between sweeper runs.
 */
export const SWEEP_MS = 5 * 60_000;

/**
 * Live sessions one user may hold on one process. Each holds an MCP
 * `Server`/transport pair in memory until it is ended or idles out, and a
 * client that never ends its sessions (or a script) would otherwise grow
 * them without bound. Opening one more ends that user's least recently used
 * session: its client gets a 404 and re-initialises.
 *
 * The cap is per process, on purpose: what it bounds is this process's
 * memory, and counting across replicas would cost a shared-store round trip
 * on every session open. With N replicas sharing a Redis store, a user may
 * hold up to N times this number across the fleet; a single-process
 * deployment holds exactly this many at most.
 */
export const MAX_SESSIONS_PER_USER = 20;

/**
 * Ids of the sessions of `userId` beyond the cap, least recently used
 * first, never `keepId` (the session just stored).
 */
export function sessionsOverCap(
  sessions: Iterable<Session>,
  userId: string,
  keepId: string,
): string[] {
  const own = [...sessions]
    .filter((s) => s.userId === userId)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  const excess = own.length - MAX_SESSIONS_PER_USER;
  if (excess <= 0) return [];
  return own
    .filter((s) => s.id !== keepId)
    .slice(0, excess)
    .map((s) => s.id);
}

/**
 * Process-local registry of live MCP sessions with a background TTL sweep.
 *
 * Notes:
 *  - The sweeper is scheduled in the constructor (not `onModuleInit`) so
 *    short-lived specs that instantiate the store directly still get
 *    deterministic behavior. The interval is `.unref()`-ed so Jest does not
 *    hang on shutdown, and a `stop()` method lets tests clear it explicitly.
 *  - `delete()` closes the transport and the server; failures there are
 *    swallowed because the session is being abandoned anyway.
 *
 * Public API is unchanged from the previous `SessionStore` class — this is
 * a rename + interface adoption. Callers should now inject via the
 * `SESSION_STORE` token (see `mcp.module.ts`).
 */
@Injectable()
export class InMemorySessionStore implements SessionStore {
  private readonly log = new Logger(InMemorySessionStore.name);
  private readonly sessions = new Map<string, Session>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
    this.sweeper.unref();
  }

  async put(s: Session): Promise<void> {
    this.sessions.set(s.id, s);
    for (const id of sessionsOverCap(this.sessions.values(), s.userId, s.id)) {
      this.log.debug(`Ending session ${id}: per-user session cap reached`);
      await this.delete(id);
    }
  }

  get(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (s) s.lastUsed = Date.now();
    return s;
  }

  async getMetadata(id: string): Promise<SessionMetadata | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    return {
      id: s.id,
      userId: s.userId,
      surface: s.surface,
      clientName: s.clientName,
    };
  }

  async delete(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    try {
      await s.transport.close();
    } catch {
      /* noop */
    }
    try {
      await s.server.close();
    } catch {
      /* noop */
    }
  }

  /**
   * Explicit teardown for tests / graceful shutdown. Without this, the
   * interval would keep Jest's event loop alive (even `.unref()` is not
   * enough when fake timers are in play).
   */
  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastUsed > TTL_MS) {
        this.log.debug(`Evicting idle session ${id}`);
        await this.delete(id);
      }
    }
  }
}
