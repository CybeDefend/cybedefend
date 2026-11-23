import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { FastifyReply, FastifyRequest } from 'fastify';

import {
  CurrentUser,
  UserContext,
} from '../../core/guards/auth/current-user.decorator';
import { McpService } from './mcp.service';
import { SessionStore, SESSION_STORE } from './session/session-store.interface';
import { extractClientName } from './shared/client-name';

/**
 * Header the MCP Streamable HTTP spec uses to correlate follow-up JSON-RPC
 * requests with a server-side session.
 */
const MCP_SESSION_HEADER = 'mcp-session-id';

/**
 * True when the body opens a session: an `initialize` request, alone (a
 * batch may not carry it with other messages).
 */
function opensSession(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.length === 1 && isInitializeRequest(body[0]);
  }
  return isInitializeRequest(body);
}

/**
 * Single public entry point for the MCP Streamable HTTP transport.
 *
 * Deliberately NOT annotated with `@Public()`: the global `AuthGuard` must
 * apply so every JSON-RPC request carries a valid bearer token. The
 * authenticated `userId` + raw `accessToken` flow into each session (see
 * `McpService.createSession`) and get threaded through to every tool.
 *
 * POST /mcp routing:
 *  1. Local session hit  → dispatch to existing transport.
 *  2. Cross-pod hit      → `getMetadata()` found it in Redis → validate
 *     ownership (403 if userId mismatch) → `adoptSession()` → dispatch.
 *  3. Miss everywhere    → `createSession()` → set response header → dispatch.
 *
 * Only an `initialize` request without a session id opens a session; any
 * other request without one is refused with 400 before anything is stored.
 *
 * DELETE /mcp with the `Mcp-Session-Id` header (the transport spec's form)
 * or DELETE /mcp/:sessionId — explicit client teardown (204; 404 for an
 * unknown session).
 *
 * The transport writes the response body itself (streaming / chunked), so
 * `@Res({ passthrough: false })` is used and we call `transport.handleRequest`
 * with the raw Node req/res obtained from Fastify.
 */
@Controller('mcp')
export class McpController {
  private readonly log = new Logger(McpController.name);

  constructor(
    private readonly mcp: McpService,
    @Inject(SESSION_STORE) private readonly store: SessionStore,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) res: FastifyReply,
    @Headers(MCP_SESSION_HEADER) sessionId: string | undefined,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    // 1. Local hit — fast path
    const existing = sessionId ? await this.store.get(sessionId) : undefined;
    if (existing) {
      // A session answers its own user only, as on the adoption and delete
      // paths: otherwise anyone who knows a session id could drive it and
      // replace its bearer.
      if (existing.userId !== user.userId) {
        res.raw.writeHead(403);
        res.raw.end();
        return;
      }
      // Refresh the per-session bearer to the freshest one AuthGuard just
      // validated. Without this, the MCP `Server` closure built at
      // `createSession` keeps using the token captured then — Claude Code's
      // ~15-minute OAuth refresh never reaches the Gateway-bound tool
      // calls, and downstream 401s surface as "Token expired" mid-session.
      // The ref is the source of truth read by `mcp-server.factory.ts`;
      // the snapshot field is kept in sync for observability and tests.
      existing.accessTokenRef.current = user.accessToken;
      existing.accessToken = user.accessToken;
      await existing.transport.handleRequest(req.raw, res.raw, req.body);
      return;
    }

    // 2. Cross-pod adoption — session exists in Redis but the transport lives
    //    on a sibling pod. Reconstruct a fresh Server/transport pair locally
    //    and pre-initialize it so the client can resume without re-sending
    //    `initialize`.
    if (sessionId && this.store.getMetadata) {
      const meta = await this.store.getMetadata(sessionId);
      if (meta) {
        if (meta.userId !== user.userId) {
          // Refuse adoption when the session belongs to another user.
          res.raw.writeHead(403);
          res.raw.end();
          return;
        }
        this.log.log(
          `MCP adopt cross-pod session userId=${user.userId} sessionId=${sessionId}`,
        );
        const { transport } = await this.mcp.adoptSession(
          sessionId,
          user.accessToken,
          user.userId,
          meta.clientName,
        );
        await transport.handleRequest(req.raw, res.raw, req.body);
        return;
      }
    }

    // 3. Stale / unknown session id — the MCP HTTP transport spec requires
    //    HTTP 404 so the client knows to drop its cached session id and
    //    re-issue `initialize`. Common causes: server restart wiping the
    //    InMemorySessionStore (no REDIS_URL set), Redis eviction, or a
    //    forged id. The previous behaviour silently created a NEW session
    //    and dispatched the incoming `tools/call` against it, which the
    //    SDK rejected with "Server not initialized" — the request never
    //    reached the tool layer and the agent received a confusing JSON-RPC
    //    error instead of the spec-defined session-expired signal.
    if (sessionId) {
      this.log.log(
        `MCP unknown sessionId=${sessionId} userId=${user.userId} → 404 (client should re-init)`,
      );
      res.raw.writeHead(404);
      res.raw.end();
      return;
    }

    // 4. First contact — no session id provided. Only `initialize` opens a
    //    session: a session minted for anything else would be refused by the
    //    SDK ("Server not initialized") yet stay stored until the idle
    //    timeout, one orphan per request. The client names itself only in
    //    `initialize`, so its name is read here and kept with the session.
    if (!opensSession(req.body)) {
      res.raw.writeHead(400, { 'content-type': 'application/json' });
      res.raw.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message:
              'Bad Request: Mcp-Session-Id header is required, or send an initialize request to open a session',
          },
          id: null,
        }),
      );
      return;
    }
    this.log.log(
      `MCP new session for userId=${user.userId} sessionId=${sessionId ?? '(none)'}`,
    );
    const { id, transport } = await this.mcp.createSession(
      user.accessToken,
      user.userId,
      extractClientName(req.body),
    );
    res.raw.setHeader(MCP_SESSION_HEADER, id);
    await transport.handleRequest(req.raw, res.raw, req.body);
  }

  /**
   * GET /mcp — the Streamable HTTP transport spec lets servers OPTIONALLY
   * accept a GET to open a server-initiated SSE channel. We don't ship
   * server-initiated messages (every tool is request/response), so the
   * spec-compliant response here is 405 Method Not Allowed with an
   * `Allow` header advertising the verbs we do support.
   *
   * Why this route even exists if we 405:
   *  - Some MCP clients (Windsurf, MCP Inspector, Devin's client) probe
   *    with GET before POST to detect protocol features. Without a route
   *    handler, Nest returns 404 — and 404 short-circuits the OAuth
   *    discovery path (the client treats the server as missing rather
   *    than "logged out").
   *  - With this handler in place, the controller-wide AuthGuard runs
   *    first. Unauthenticated GET → 401 + WWW-Authenticate pointing at
   *    `.well-known/oauth-protected-resource`. The client then runs the
   *    standard OAuth discovery flow and comes back with a Bearer token
   *    on the next POST. Authenticated GET → 405 (we don't stream).
   */
  @Get()
  @HttpCode(405)
  async noServerStreaming(
    @Res({ passthrough: false }) res: FastifyReply,
  ): Promise<void> {
    res.raw.setHeader('Allow', 'POST, DELETE');
    res.raw.statusCode = 405;
    res.raw.setHeader('content-type', 'application/json');
    res.raw.end(
      JSON.stringify({
        error: 'method_not_allowed',
        error_description:
          'This MCP server does not support server-initiated SSE on GET. ' +
          'Use POST /mcp for JSON-RPC requests.',
      }),
    );
  }

  /**
   * DELETE /mcp with the `Mcp-Session-Id` header: how the Streamable HTTP
   * transport ends a session (the SDK client's `terminateSession()`).
   */
  @Delete()
  @HttpCode(204)
  async terminateFromHeader(
    @Headers(MCP_SESSION_HEADER) sessionId: string | undefined,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    if (!sessionId) {
      throw new BadRequestException('Mcp-Session-Id header is required');
    }
    await this.end(sessionId, user);
  }

  @Delete(':sessionId')
  @HttpCode(204)
  async terminate(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: UserContext,
  ): Promise<void> {
    await this.end(sessionId, user);
  }

  /**
   * Ends a session its caller owns. An unknown id is a 404, as for a POST,
   * so a client learns the id is no longer valid.
   */
  private async end(sessionId: string, user: UserContext): Promise<void> {
    const meta = this.store.getMetadata
      ? await this.store.getMetadata(sessionId)
      : null;

    if (!meta) {
      throw new NotFoundException('Unknown MCP session');
    }

    if (meta.userId !== user.userId) {
      throw new ForbiddenException();
    }

    await this.mcp.destroy(sessionId);
  }
}
