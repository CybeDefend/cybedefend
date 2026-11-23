import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Which MCP surface a session was born on. Only the public surface exists:
 * there is no internal surface.
 */
export type SessionSurface = 'public';

/**
 * One MCP session: its `Server`/`StreamableHTTPServerTransport` pair plus the
 * end-user identity forwarded with every `tools/call`. `lastUsed` is bumped
 * by `get()` so active sessions survive the TTL sweeper.
 *
 * `surface` is required (not optional) so a forgotten value can never
 * default to the wrong audience — fail-loud at compile-time.
 *
 * `accessToken` vs `accessTokenRef` — the two fields stay in sync but serve
 * different consumers:
 *   - `accessToken` is the denormalised snapshot of the current bearer used
 *     for observability and tests that just want to read the latest value.
 *   - `accessTokenRef.current` is the SOURCE OF TRUTH the per-session MCP
 *     `Server` closure reads at tool-dispatch time. Because closures over
 *     primitives capture by value, the previous design froze the bearer at
 *     session creation; tool calls in long-lived sessions kept hitting
 *     Gateway with a stale token after Claude Code's refresh, returning 401
 *     and surfacing as the "Token expired after 15 minutes" symptom.
 *     Capturing the holder OBJECT lets the controller mutate
 *     `accessTokenRef.current` on each authenticated request so every
 *     tool call sees the freshest bearer.
 */
export interface Session {
  id: string;
  server: Server;
  transport: StreamableHTTPServerTransport;
  userId: string;
  accessToken: string;
  accessTokenRef: { current: string };
  surface: SessionSurface;
  /**
   * Name the MCP client declared in its `initialize` request (`claude-code`,
   * `cursor-vscode`…), sanitised. Absent when the client sent none.
   */
  clientName?: string;
  createdAt: number;
  lastUsed: number;
}

/**
 * Serialisable subset returned by `getMetadata()` — contains only what the
 * controller needs to validate ownership and trigger adoption.
 *
 * `surface` and `clientName` survive Redis serialisation so an adopting
 * replica can rebuild the same tool context: the client name is declared
 * only once, in the `initialize` request the adopting pod never saw.
 */
export interface SessionMetadata {
  id: string;
  userId: string;
  surface: SessionSurface;
  clientName?: string;
}

/**
 * Storage contract for live MCP sessions.
 *
 * Two implementations ship:
 *  - `InMemorySessionStore` — single-replica / local dev.
 *  - `RedisSessionStore`    — multi-replica deploys. Stores session metadata
 *    in Redis so a sibling pod sees the session id, but keeps the
 *    process-local `Server`/`transport` pair in-memory. A cross-replica hit
 *    returns `undefined` so the client re-initialises — full state
 *    serialisation is out of scope.
 *
 * `get()` SHOULD refresh `lastUsed` as a side effect so active sessions
 * survive the TTL sweeper / Redis EX.
 *
 * `getMetadata(id)` returns the lightweight identity envelope if the session
 * is known to the store (including Redis-only cross-replica entries).
 * Returns `null` if the session does not exist anywhere. Controllers use
 * this to decide whether to adopt a cross-pod session.
 *
 * `stop()` is optional and used by tests / graceful shutdown to clear any
 * background sweeper and close shared connections (e.g. Redis).
 */
export interface SessionStore {
  put(session: Session): Promise<void> | void;
  get(id: string): Promise<Session | undefined> | (Session | undefined);
  delete(id: string): Promise<void>;
  getMetadata?(id: string): Promise<SessionMetadata | null>;
  stop?(): void | Promise<void>;
}

/**
 * DI token used across the module so callers inject the interface rather
 * than a concrete class. Lets us swap between `InMemorySessionStore` and
 * `RedisSessionStore` via the factory in `mcp.module.ts`.
 */
export const SESSION_STORE = 'SESSION_STORE';
