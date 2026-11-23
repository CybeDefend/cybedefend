import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type {
  SessionStore,
  SessionSurface,
} from '../session/session-store.interface';
import { ToolRegistry } from '../tools/registry';
import { PromptRegistry } from '../prompts/registry';
import { buildMcpServer } from './mcp-server.factory';
import { preInitializeTransport } from './preinitialize-transport';
import type { ToolCallReporter } from '../session/agent-session-reporter.token';
import type { McpEditionTexts } from '../../../edition/ports/mcp-edition-texts.port';

/**
 * Shared lifecycle logic for the public MCP surface (`/mcp`).
 *
 * Concrete subclasses bind the {@link ToolRegistry} that drives
 * `tools/list` and `tools/call`, plus the {@link SessionSurface} carried
 * by every session created here.
 *
 * The class intentionally has no `@Injectable()` decorator: Nest only
 * instantiates the concrete subclass (`McpService`), registered as its
 * own DI token.
 */
export abstract class AbstractMcpService {
  protected abstract readonly surface: SessionSurface;

  protected constructor(
    protected readonly store: SessionStore,
    protected readonly registry: ToolRegistry,
    protected readonly logger: Logger,
    // Optional: when supplied (the public `/mcp` surface) the built server
    // also serves MCP prompts.
    protected readonly promptRegistry?: PromptRegistry,
    // Optional: when supplied, every tool call reports its session to
    // Gateway, fire-and-forget.
    protected readonly sessionReporter?: ToolCallReporter,
    // Optional: when supplied, `texts.serverInstructions` is the server's
    // `instructions` string.
    protected readonly texts?: McpEditionTexts,
  ) {}

  /**
   * `clientName` is the name the client declared in the `initialize`
   * request that opens the session (see `extractClientName`).
   */
  async createSession(
    accessToken: string,
    userId: string,
    clientName?: string,
  ): Promise<{ id: string; transport: StreamableHTTPServerTransport }> {
    const id = randomUUID();
    const accessTokenRef = { current: accessToken };
    const server = this.buildServer(id, userId, accessTokenRef, clientName);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => id,
    });
    await server.connect(transport);

    await this.store.put({
      id,
      server,
      transport,
      userId,
      accessToken,
      accessTokenRef,
      surface: this.surface,
      clientName,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    return { id, transport };
  }

  /**
   * `clientName` comes from the session metadata: this pod never saw the
   * `initialize` request that declared it.
   */
  async adoptSession(
    sessionId: string,
    accessToken: string,
    userId: string,
    clientName?: string,
  ): Promise<{ id: string; transport: StreamableHTTPServerTransport }> {
    const accessTokenRef = { current: accessToken };
    const server = this.buildServer(
      sessionId,
      userId,
      accessTokenRef,
      clientName,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });
    await server.connect(transport);
    preInitializeTransport(transport, sessionId);

    await this.store.put({
      id: sessionId,
      server,
      transport,
      userId,
      accessToken,
      accessTokenRef,
      surface: this.surface,
      clientName,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });

    return { id: sessionId, transport };
  }

  async destroy(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /**
   * `accessTokenRef` is a mutable holder, not a value. The closure inside
   * `buildMcpServer` reads `.current` at tool-dispatch time so the
   * controller's per-request mutation (`existing.accessTokenRef.current =
   * user.accessToken`) is picked up by every downstream Gateway call.
   * Passing the holder by reference here is the load-bearing design choice
   * that prevents the "stale bearer after ~15 min" 401s.
   *
   * `sessionId` only feeds the session reporter, which hashes it before
   * anything leaves this service.
   */
  private buildServer(
    sessionId: string,
    userId: string,
    accessTokenRef: { current: string },
    clientName: string | undefined,
  ): Server {
    return buildMcpServer(
      this.registry,
      userId,
      () => accessTokenRef.current,
      this.logger,
      this.promptRegistry,
      clientName,
      this.sessionReporter
        ? (args, accessToken) =>
            this.sessionReporter.reportToolCall({
              sessionId,
              args,
              accessToken,
              clientName,
            })
        : undefined,
      this.texts?.serverInstructions,
    );
  }
}
