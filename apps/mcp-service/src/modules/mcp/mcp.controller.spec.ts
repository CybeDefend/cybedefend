/**
 * Unit specs for `McpController.handle()`.
 *
 * All tests drive the controller method directly — no HTTP layer involved.
 * SessionStore and McpService are mocked so tests focus on the routing
 * decisions in `handle()`: local hit, new session, cross-pod adoption,
 * and ownership 403.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { SESSION_STORE } from './session/session-store.interface';
import type {
  Session,
  SessionMetadata,
} from './session/session-store.interface';
import type { UserContext } from '../../core/guards/auth/current-user.decorator';

const mockTransport = { handleRequest: jest.fn(async () => {}) };

/** A valid `initialize` request. */
const INITIALIZE = {
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
  id: 0,
};

const mockStore = {
  get: jest.fn<Promise<Session | undefined>, [string]>(),
  put: jest.fn(async () => {}),
  delete: jest.fn(async () => {}),
  getMetadata: jest.fn<Promise<SessionMetadata | null>, [string]>(),
};

const mockMcpService = {
  createSession: jest.fn(async () => ({
    id: 'new-id',
    transport: mockTransport,
  })),
  adoptSession: jest.fn(async () => ({
    id: 'adopted-id',
    transport: mockTransport,
  })),
  destroy: jest.fn(async () => {}),
};

function makeReq(body: unknown = {}) {
  return { raw: {}, body } as any;
}

function makeRes() {
  const endMock = jest.fn();
  const writeHeadMock = jest.fn();
  return {
    raw: { setHeader: jest.fn(), writeHead: writeHeadMock, end: endMock },
    _end: endMock,
    _writeHead: writeHeadMock,
  } as any;
}

function makeUser(userId = 'u1', accessToken = 'tok'): UserContext {
  return { userId, accessToken };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sid',
    userId: 'u1',
    accessToken: 't',
    accessTokenRef: { current: 't' },
    server: {} as any,
    transport: mockTransport as any,
    surface: 'public',
    createdAt: 0,
    lastUsed: 0,
    ...overrides,
  };
}

describe('McpController.handle()', () => {
  let controller: McpController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.get.mockResolvedValue(undefined);
    mockStore.getMetadata.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: mockMcpService },
        { provide: SESSION_STORE, useValue: mockStore },
      ],
    }).compile();

    controller = module.get(McpController);
  });

  it('dispatches to existing local transport on session hit', async () => {
    const localTransport = { handleRequest: jest.fn(async () => {}) };
    mockStore.get.mockResolvedValueOnce(
      makeSession({ id: 'local-sid', transport: localTransport as any }),
    );

    const req = makeReq({ method: 'tools/list' });
    const res = makeRes();
    await controller.handle(req, res, 'local-sid', makeUser());

    expect(localTransport.handleRequest).toHaveBeenCalledWith(
      req.raw,
      res.raw,
      req.body,
    );
    expect(mockMcpService.createSession).not.toHaveBeenCalled();
    expect(mockMcpService.adoptSession).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION GUARD for the "Token expired after 15 min" symptom.
   *
   * An OAuth MCP client refreshes its bearer transparently when it expires
   * (`offline_access` scope). The fresh token arrives in the
   * `Authorization` header of the next `POST /mcp` request; AuthGuard
   * validates it; the controller MUST then write it into the session's
   * mutable `accessTokenRef` BEFORE dispatching to the transport, so the
   * MCP `Server` closure (and every Gateway call it makes) uses the new
   * bearer. Without this update, the session keeps the bearer captured
   * at `createSession` and Gateway eventually 401s — the very bug this
   * test guards against.
   */
  it('refreshes the session accessTokenRef with the request bearer before dispatching on local hit', async () => {
    const localTransport = { handleRequest: jest.fn(async () => {}) };
    const session = makeSession({
      id: 'local-sid',
      transport: localTransport as any,
      accessToken: 'stale-tok',
      accessTokenRef: { current: 'stale-tok' },
    });
    mockStore.get.mockResolvedValueOnce(session);

    const req = makeReq({ method: 'tools/call' });
    const res = makeRes();
    await controller.handle(req, res, 'local-sid', makeUser('u1', 'fresh-tok'));

    // Both the ref (source of truth for the MCP server closure) and the
    // denormalised snapshot get the fresh value.
    expect(session.accessTokenRef.current).toBe('fresh-tok');
    expect(session.accessToken).toBe('fresh-tok');
    expect(localTransport.handleRequest).toHaveBeenCalled();
  });

  it('updates the session accessTokenRef BEFORE invoking transport.handleRequest', async () => {
    const session = makeSession({
      id: 'order-sid',
      accessToken: 'old',
      accessTokenRef: { current: 'old' },
    });
    let refAtDispatchTime: string | undefined;
    const localTransport = {
      handleRequest: jest.fn(async () => {
        // Capture the ref value at the moment the transport handles the
        // request — proves the mutation already happened.
        refAtDispatchTime = session.accessTokenRef.current;
      }),
    };
    session.transport = localTransport as any;
    mockStore.get.mockResolvedValueOnce(session);

    const req = makeReq();
    const res = makeRes();
    await controller.handle(req, res, 'order-sid', makeUser('u1', 'new-tok'));

    expect(refAtDispatchTime).toBe('new-tok');
  });

  it('creates no session for a request without a session id that is not initialize', async () => {
    // Only `initialize` opens a session. Anything else without a session id
    // used to mint and store a session that the SDK then refused: one orphan
    // per request, kept until the idle timeout.
    for (const body of [
      { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      { foo: 1 },
      {},
      [INITIALIZE, { x: 1 }],
      // A malformed initialize opens nothing either.
      { jsonrpc: '2.0', method: 'initialize', params: {}, id: 0 },
    ]) {
      const req = makeReq(body);
      const res = makeRes();
      await controller.handle(req, res, undefined, makeUser('u1', 'tok'));

      expect(res._writeHead).toHaveBeenCalledWith(400, {
        'content-type': 'application/json',
      });
      const sent = JSON.parse(res._end.mock.calls[0][0]);
      expect(sent).toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: expect.stringContaining('Mcp-Session-Id'),
        },
        id: null,
      });
    }
    expect(mockMcpService.createSession).not.toHaveBeenCalled();
    expect(mockTransport.handleRequest).not.toHaveBeenCalled();
  });

  it('opens a session for an initialize request sent alone in a batch', async () => {
    const req = makeReq([INITIALIZE]);
    const res = makeRes();
    await controller.handle(req, res, undefined, makeUser('u1', 'tok'));

    expect(mockMcpService.createSession).toHaveBeenCalled();
    expect(mockTransport.handleRequest).toHaveBeenCalled();
  });

  it('returns 404 when session id is provided but unknown (fully expired / server restart)', async () => {
    // MCP HTTP transport spec: an unknown Mcp-Session-Id means the client
    // is referring to a session the server has lost (typically: server
    // restart wiping the InMemorySessionStore, or Redis eviction). The
    // server MUST respond 404; a well-behaved client then drops its cached
    // session id and re-sends `initialize`. The previous behaviour created
    // a NEW session and dispatched the incoming `tools/call` against it,
    // which the SDK rejected with "Server not initialized" because a
    // fresh session needs `initialize` first.
    mockStore.get.mockResolvedValueOnce(undefined);
    mockStore.getMetadata.mockResolvedValueOnce(null);

    const req = makeReq({ jsonrpc: '2.0', method: 'tools/call', id: 1 });
    const res = makeRes();
    await controller.handle(req, res, 'expired-sid', makeUser('u1', 'tok'));

    // 404 sent, no session created, no dispatch attempted.
    expect(res._writeHead).toHaveBeenCalledWith(404);
    expect(res._end).toHaveBeenCalled();
    expect(mockMcpService.createSession).not.toHaveBeenCalled();
    expect(mockTransport.handleRequest).not.toHaveBeenCalled();
  });

  it('still creates a fresh session when NO session id is provided', async () => {
    // Path stays correct for first-contact: client sends `initialize` with
    // no Mcp-Session-Id → we mint a new session, set the response header,
    // and dispatch (which the SDK accepts because the body IS initialize).
    const req = makeReq(INITIALIZE);
    const res = makeRes();
    await controller.handle(req, res, undefined, makeUser('u1', 'tok'));

    expect(mockMcpService.createSession).toHaveBeenCalledWith(
      'tok',
      'u1',
      'test-client',
    );
    expect(res.raw.setHeader).toHaveBeenCalledWith('mcp-session-id', 'new-id');
    expect(mockTransport.handleRequest).toHaveBeenCalled();
  });

  it('adopts a cross-pod session when metadata exists and userId matches', async () => {
    mockStore.get.mockResolvedValueOnce(undefined);
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'remote-sid',
      userId: 'u1',
      surface: 'public',
    });
    mockMcpService.adoptSession.mockResolvedValueOnce({
      id: 'remote-sid',
      transport: mockTransport,
    });

    const req = makeReq();
    const res = makeRes();
    await controller.handle(req, res, 'remote-sid', makeUser('u1', 'new-tok'));

    // The metadata carries no client name, so neither does the adoption.
    expect(mockMcpService.adoptSession).toHaveBeenCalledWith(
      'remote-sid',
      'new-tok',
      'u1',
      undefined,
    );
    expect(mockTransport.handleRequest).toHaveBeenCalledWith(
      req.raw,
      res.raw,
      req.body,
    );
    expect(mockMcpService.createSession).not.toHaveBeenCalled();
  });

  it('opens the session with the client name declared in the initialize request', async () => {
    const req = makeReq({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-code', version: '2.1.3' },
      },
    });
    const res = makeRes();
    await controller.handle(req, res, undefined, makeUser('u1', 'tok'));

    expect(mockMcpService.createSession).toHaveBeenCalledWith(
      'tok',
      'u1',
      'claude-code',
    );
  });

  it('hands the client name recorded by the other pod to the adopted session', async () => {
    mockStore.get.mockResolvedValueOnce(undefined);
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'remote-sid',
      userId: 'u1',
      surface: 'public',
      clientName: 'cursor-vscode',
    });

    const req = makeReq({ jsonrpc: '2.0', id: 3, method: 'tools/call' });
    const res = makeRes();
    await controller.handle(req, res, 'remote-sid', makeUser('u1', 'tok'));

    expect(mockMcpService.adoptSession).toHaveBeenCalledWith(
      'remote-sid',
      'tok',
      'u1',
      'cursor-vscode',
    );
  });

  it('returns 403 on a local hit when the session belongs to another user, and leaves its bearer untouched', async () => {
    const localTransport = { handleRequest: jest.fn(async () => {}) };
    const session = makeSession({
      id: 'local-sid',
      userId: 'real-owner',
      transport: localTransport as any,
      accessToken: 'owner-tok',
      accessTokenRef: { current: 'owner-tok' },
    });
    mockStore.get.mockResolvedValueOnce(session);

    const req = makeReq({ method: 'tools/call' });
    const res = makeRes();
    await controller.handle(
      req,
      res,
      'local-sid',
      makeUser('other-user', 'other-tok'),
    );

    expect(res._writeHead).toHaveBeenCalledWith(403);
    expect(res._end).toHaveBeenCalled();
    expect(localTransport.handleRequest).not.toHaveBeenCalled();
    expect(session.accessTokenRef.current).toBe('owner-tok');
    expect(session.accessToken).toBe('owner-tok');
    expect(mockMcpService.createSession).not.toHaveBeenCalled();
    expect(mockMcpService.adoptSession).not.toHaveBeenCalled();
  });

  it('returns 403 when metadata userId does not match the JWT userId', async () => {
    mockStore.get.mockResolvedValueOnce(undefined);
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'foreign-sid',
      userId: 'real-owner',
      surface: 'public',
    });

    const req = makeReq();
    const res = makeRes();
    await controller.handle(
      req,
      res,
      'foreign-sid',
      makeUser('other-user', 'tok'),
    );

    expect(res._writeHead).toHaveBeenCalledWith(403);
    expect(res._end).toHaveBeenCalled();
    expect(mockMcpService.adoptSession).not.toHaveBeenCalled();
    expect(mockMcpService.createSession).not.toHaveBeenCalled();
  });
});

describe('McpController.terminate()', () => {
  let controller: McpController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.get.mockResolvedValue(undefined);
    mockStore.getMetadata.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: mockMcpService },
        { provide: SESSION_STORE, useValue: mockStore },
      ],
    }).compile();

    controller = module.get(McpController);
  });

  it('destroys the session when the caller owns it', async () => {
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'sid',
      userId: 'u1',
      surface: 'public',
    });

    await controller.terminate('sid', makeUser('u1'));

    expect(mockMcpService.destroy).toHaveBeenCalledWith('sid');
  });

  it('answers 404 for a session it does not know, as for a POST', async () => {
    mockStore.getMetadata.mockResolvedValueOnce(null);

    await expect(
      controller.terminate('gone-sid', makeUser('u1')),
    ).rejects.toThrow(NotFoundException);

    expect(mockMcpService.destroy).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when the caller does not own the session', async () => {
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'sid',
      userId: 'real-owner',
      surface: 'public',
    });

    await expect(
      controller.terminate('sid', makeUser('other-user')),
    ).rejects.toThrow(ForbiddenException);

    expect(mockMcpService.destroy).not.toHaveBeenCalled();
  });
});

/**
 * DELETE /mcp with the `Mcp-Session-Id` header: how the Streamable HTTP
 * transport ends a session (the SDK's `terminateSession()`).
 */
describe('McpController.terminateFromHeader()', () => {
  let controller: McpController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.getMetadata.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: mockMcpService },
        { provide: SESSION_STORE, useValue: mockStore },
      ],
    }).compile();
    controller = module.get(McpController);
  });

  it('is routed on DELETE /mcp itself', () => {
    const path = Reflect.getMetadata(
      PATH_METADATA,
      McpController.prototype.terminateFromHeader,
    );
    const method = Reflect.getMetadata(
      METHOD_METADATA,
      McpController.prototype.terminateFromHeader,
    );
    expect(path).toBe('/');
    expect(method).toBe(RequestMethod.DELETE);
  });

  it('destroys the session named by the header when the caller owns it', async () => {
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'sid',
      userId: 'u1',
      surface: 'public',
    });

    await controller.terminateFromHeader('sid', makeUser('u1'));

    expect(mockMcpService.destroy).toHaveBeenCalledWith('sid');
  });

  it("refuses another user's session and keeps it", async () => {
    mockStore.getMetadata.mockResolvedValueOnce({
      id: 'sid',
      userId: 'owner',
      surface: 'public',
    });

    await expect(
      controller.terminateFromHeader('sid', makeUser('u1')),
    ).rejects.toThrow(ForbiddenException);
    expect(mockMcpService.destroy).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown session and 400 without the header', async () => {
    await expect(
      controller.terminateFromHeader('nope', makeUser('u1')),
    ).rejects.toThrow(NotFoundException);
    await expect(
      controller.terminateFromHeader(undefined, makeUser('u1')),
    ).rejects.toThrow(BadRequestException);
    expect(mockMcpService.destroy).not.toHaveBeenCalled();
  });
});

/**
 * GET /mcp tests.
 *
 * The endpoint exists ONLY to give the AuthGuard a route to attach to —
 * without it, unauthenticated GET probes return 404 (route not found)
 * and OAuth-aware MCP clients (Windsurf, Devin, MCP Inspector) bail
 * before they can discover the `WWW-Authenticate` header that points
 * at our protected-resource metadata. With the handler in place,
 * unauthenticated GET → 401 + WWW-Authenticate (via AuthGuard, tested
 * separately in `auth.guard.spec.ts`), authenticated GET → 405 (no
 * server-initiated SSE in this MCP server).
 */
describe('McpController.noServerStreaming()', () => {
  let controller: McpController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: mockMcpService },
        { provide: SESSION_STORE, useValue: mockStore },
      ],
    }).compile();
    controller = module.get(McpController);
  });

  it('returns 405 with an Allow header listing the supported verbs', async () => {
    const res = makeRes();
    await controller.noServerStreaming(res);

    const allowCalls = (res.raw.setHeader as jest.Mock).mock.calls.filter(
      (c) => String(c[0]).toLowerCase() === 'allow',
    );
    expect(allowCalls).toHaveLength(1);
    expect(allowCalls[0][1]).toContain('POST');
    expect(allowCalls[0][1]).toContain('DELETE');
    expect(res.raw.statusCode).toBe(405);
  });

  it('returns a JSON error body explaining why GET is rejected', async () => {
    const res = makeRes();
    await controller.noServerStreaming(res);

    expect(res.raw.end).toHaveBeenCalledTimes(1);
    const body = JSON.parse((res.raw.end as jest.Mock).mock.calls[0][0]);
    expect(body.error).toBe('method_not_allowed');
    expect(body.error_description).toMatch(/POST/);
  });
});

/**
 * GET /mcp tests.
 *
 * The endpoint exists ONLY to give the AuthGuard a route to attach to —
 * without it, unauthenticated GET probes return 404 (route not found)
 * and OAuth-aware MCP clients (Windsurf, Devin, MCP Inspector) bail
 * before they can discover the `WWW-Authenticate` header that points
 * at our protected-resource metadata. With the handler in place,
 * unauthenticated GET → 401 + WWW-Authenticate (via AuthGuard, tested
 * separately in `auth.guard.spec.ts`), authenticated GET → 405 (no
 * server-initiated SSE in this MCP server).
 */
describe('McpController.noServerStreaming()', () => {
  let controller: McpController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: McpService, useValue: mockMcpService },
        { provide: SESSION_STORE, useValue: mockStore },
      ],
    }).compile();
    controller = module.get(McpController);
  });

  it('returns 405 with an Allow header listing the supported verbs', async () => {
    const res = makeRes();
    await controller.noServerStreaming(res);

    const allowCalls = (res.raw.setHeader as jest.Mock).mock.calls.filter(
      (c) => String(c[0]).toLowerCase() === 'allow',
    );
    expect(allowCalls).toHaveLength(1);
    expect(allowCalls[0][1]).toContain('POST');
    expect(allowCalls[0][1]).toContain('DELETE');
    expect(res.raw.statusCode).toBe(405);
  });

  it('returns a JSON error body explaining why GET is rejected', async () => {
    const res = makeRes();
    await controller.noServerStreaming(res);

    expect(res.raw.end).toHaveBeenCalledTimes(1);
    const body = JSON.parse((res.raw.end as jest.Mock).mock.calls[0][0]);
    expect(body.error).toBe('method_not_allowed');
    expect(body.error_description).toMatch(/POST/);
  });
});
