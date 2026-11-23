/**
 * Unit specs for `McpService`.
 *
 * The real MCP SDK `Server` and `StreamableHTTPServerTransport` are heavy
 * (they bind lifecycles, streams, protocol loops) — we mock both module
 * paths here so we can test the *service's* contract in isolation:
 *  - it creates a session, stores it, and hands back a UUID-shaped id;
 *  - it wires both `tools/list` and `tools/call` handlers on the server;
 *  - `destroy(id)` removes the session via the store.
 */

const serverInstances: any[] = [];
const transportInstances: any[] = [];

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: jest.fn().mockImplementation(() => {
      const handlers = new Map<unknown, (req: unknown) => unknown>();
      const instance = {
        handlers,
        setRequestHandler: jest.fn(
          (schema: unknown, handler: (req: unknown) => unknown) => {
            handlers.set(schema, handler);
          },
        ),
        connect: jest.fn(async () => {}),
        close: jest.fn(async () => {}),
      };
      serverInstances.push(instance);
      return instance;
    }),
  };
});

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  return {
    StreamableHTTPServerTransport: jest
      .fn()
      .mockImplementation((opts: { sessionIdGenerator: () => string }) => {
        const inner = {
          _initialized: false,
          sessionId: undefined as string | undefined,
        };
        const instance = {
          opts,
          _webStandardTransport: inner,
          handleRequest: jest.fn(async () => {}),
          close: jest.fn(async () => {}),
        };
        transportInstances.push(instance);
        return instance;
      }),
  };
});

// Import AFTER jest.mock() calls so the service picks up the mocks.
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { McpService } from './mcp.service';
import { PromptRegistry } from './prompts/registry';
import { InMemorySessionStore } from './session/session.store';
import { SESSION_STORE } from './session/session-store.interface';
import { ToolRegistry } from './tools/registry';

describe('McpService', () => {
  let svc: McpService;
  let store: InMemorySessionStore;
  let registry: ToolRegistry;
  let prompts: PromptRegistry;

  beforeEach(async () => {
    serverInstances.length = 0;
    transportInstances.length = 0;

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: { level: 'silent' } })],
      providers: [
        McpService,
        ToolRegistry,
        PromptRegistry,
        { provide: SESSION_STORE, useClass: InMemorySessionStore },
      ],
    }).compile();

    svc = moduleRef.get(McpService);
    store = moduleRef.get<InMemorySessionStore>(SESSION_STORE);
    registry = moduleRef.get(ToolRegistry);
    prompts = moduleRef.get(PromptRegistry);
  });

  function registerPrompt() {
    prompts.register({
      name: 'p',
      description: 'p',
      arguments: [],
      render: async () => ({ messages: [] }),
    });
  }

  afterEach(() => {
    store.stop();
  });

  it('createSession returns a UUID-shaped id and stores it', async () => {
    const { id } = await svc.createSession('tok-1', 'user-1');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const session = store.get(id);
    expect(session).toBeDefined();
    expect(session!.userId).toBe('user-1');
    expect(session!.accessToken).toBe('tok-1');
  });

  it('registers only tools/list and tools/call when no prompt is registered', async () => {
    await svc.createSession('t', 'u');
    expect(serverInstances[0].setRequestHandler).toHaveBeenCalledTimes(2);
  });

  it('registers tools/list, tools/call, prompts/list, and prompts/get handlers on the server', async () => {
    registerPrompt();
    await svc.createSession('t', 'u');
    expect(serverInstances).toHaveLength(1);
    const server = serverInstances[0];
    expect(server.setRequestHandler).toHaveBeenCalledTimes(4);
    // Four distinct schemas registered.
    const schemas = server.setRequestHandler.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(new Set(schemas).size).toBe(4);
  });

  it('tools/list returns an empty list when the registry is empty', async () => {
    await svc.createSession('t', 'u');
    const server = serverInstances[0];
    // The first registered handler is tools/list (see mcp.service.ts).
    const [, listHandler] = server.setRequestHandler.mock.calls[0];
    const result = await listHandler({});
    expect(result).toEqual({ tools: [] });
  });

  it('tools/list enumerates registered tools', async () => {
    registry.register({
      name: 'alpha',
      description: 'first',
      inputSchema: { type: 'object' },
      run: async () => ({}),
    });
    await svc.createSession('t', 'u');
    const server = serverInstances[0];
    const [, listHandler] = server.setRequestHandler.mock.calls[0];
    const result = (await listHandler({})) as { tools: { name: string }[] };
    expect(result.tools.map((t) => t.name)).toEqual(['alpha']);
  });

  it('tools/call returns an isError payload when the tool is unknown', async () => {
    await svc.createSession('t', 'u');
    const server = serverInstances[0];
    const [, callHandler] = server.setRequestHandler.mock.calls[1];
    const result = (await callHandler({
      params: { name: 'does-not-exist', arguments: {} },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool/i);
  });

  it('tools/call wraps string and object return values as text content without isError', async () => {
    registry.register({
      name: 'str-tool',
      description: 'returns a string',
      inputSchema: { type: 'object' },
      run: async () => 'hello world',
    });
    registry.register({
      name: 'obj-tool',
      description: 'returns an object',
      inputSchema: { type: 'object' },
      run: async () => ({ ok: true, items: [1, 2] }),
    });
    await svc.createSession('tok', 'user');
    const server = serverInstances[0];
    const [, callHandler] = server.setRequestHandler.mock.calls[1];

    const strResult = (await callHandler({
      params: { name: 'str-tool', arguments: {} },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(strResult.isError).toBeUndefined();
    expect(strResult.content).toEqual([{ type: 'text', text: 'hello world' }]);

    const objResult = (await callHandler({
      params: { name: 'obj-tool', arguments: {} },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(objResult.isError).toBeUndefined();
    expect(objResult.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ ok: true, items: [1, 2] }, null, 2),
      },
    ]);
  });

  describe('tools/call structured error payloads', () => {
    type ToolResult = {
      isError?: boolean;
      content: { type: string; text: string }[];
    };

    const parsePayload = (result: ToolResult) =>
      JSON.parse(result.content[0].text) as {
        code: string;
        message: string;
        details?: unknown;
      };

    const callTool = async (
      name: string,
      run: () => Promise<unknown>,
    ): Promise<ToolResult> => {
      registry.register({
        name,
        description: `throws ${name}`,
        inputSchema: { type: 'object' },
        run,
      });
      await svc.createSession('tok', 'user');
      const server = serverInstances[serverInstances.length - 1];
      const [, callHandler] = server.setRequestHandler.mock.calls[1];
      return callHandler({
        params: { name, arguments: {} },
      }) as Promise<ToolResult>;
    };

    it('emits a PERMISSION_DENIED payload when a tool throws PermissionDeniedError', async () => {
      const { PermissionDeniedError } = await import('./tools/errors');
      const result = await callTool('perm-tool', async () => {
        throw new PermissionDeniedError('p-1');
      });

      expect(result.isError).toBe(true);
      const payload = parsePayload(result);
      expect(payload.code).toBe('PERMISSION_DENIED');
      expect(payload.message).toMatch(/p-1/);
      expect(payload.details).toEqual({ projectId: 'p-1' });
    });

    it('maps an HTTP 403 upstream error to PERMISSION_DENIED and never echoes the body', async () => {
      const result = await callTool('upstream-403', async () => {
        throw {
          response: {
            status: 403,
            // body intentionally contains a "secret" — the mapper must drop it
            // on the floor and surface only the numeric status.
            data: { error: 'forbidden', secret: 'super-private' },
          },
          message: 'Request failed',
        };
      });
      const payload = parsePayload(result);
      expect(payload.code).toBe('PERMISSION_DENIED');
      expect(payload.details).toEqual({ statusText: 403 });
      expect(JSON.stringify(payload)).not.toContain('super-private');
      expect(JSON.stringify(payload)).not.toContain('upstream');
    });

    it('maps an HTTP 404 upstream error to NOT_FOUND', async () => {
      const result = await callTool('upstream-404', async () => {
        throw {
          response: { status: 404, data: { error: 'gone' } },
          message: 'Request failed',
        };
      });
      expect(parsePayload(result).code).toBe('NOT_FOUND');
    });

    it('maps an HTTP 400/422 upstream error to INVALID_ARGUMENT', async () => {
      const result400 = await callTool('upstream-400', async () => {
        throw {
          response: { status: 400, data: { error: 'bad input' } },
          message: 'Request failed',
        };
      });
      expect(parsePayload(result400).code).toBe('INVALID_ARGUMENT');

      const result422 = await callTool('upstream-422', async () => {
        throw {
          response: { status: 422, data: { error: 'unprocessable' } },
          message: 'Request failed',
        };
      });
      expect(parsePayload(result422).code).toBe('INVALID_ARGUMENT');
    });

    it('maps a 5xx upstream or ECONNREFUSED to UNAVAILABLE', async () => {
      const result5xx = await callTool('upstream-502', async () => {
        throw {
          response: { status: 502, data: { error: 'upstream down' } },
          message: 'Request failed',
        };
      });
      expect(parsePayload(result5xx).code).toBe('UNAVAILABLE');

      const resultEcon = await callTool('econn', async () => {
        const err = new Error('connect ECONNREFUSED') as Error & {
          code?: string;
        };
        err.code = 'ECONNREFUSED';
        throw err;
      });
      expect(parsePayload(resultEcon).code).toBe('UNAVAILABLE');
    });

    it('falls back to INTERNAL for plain Error throws', async () => {
      const result = await callTool('plain-tool', async () => {
        throw new Error('boom');
      });
      const payload = parsePayload(result);
      expect(payload.code).toBe('INTERNAL');
      expect(payload.message).toBe('boom');
    });
  });

  it('destroy removes the session', async () => {
    const { id } = await svc.createSession('t', 'u');
    expect(store.get(id)).toBeDefined();
    await svc.destroy(id);
    expect(store.get(id)).toBeUndefined();
  });

  it('forwards a minimal { userId, accessToken } tool context on tools/call', async () => {
    const runMock = jest.fn(async () => 'ok');
    registry.register({
      name: 'ctx-tool',
      description: 'ctx',
      inputSchema: { type: 'object' },
      run: runMock,
    });

    await svc.createSession('tok-x', 'user-x');

    const server = serverInstances[serverInstances.length - 1];
    const [, callHandler] = server.setRequestHandler.mock.calls[1];
    await callHandler({ params: { name: 'ctx-tool', arguments: {} } });

    expect(runMock).toHaveBeenCalledWith(
      {},
      { userId: 'user-x', accessToken: 'tok-x' },
    );
  });

  /**
   * REGRESSION GUARD: long-lived sessions must use the LATEST access token,
   * not the one captured at `createSession` time.
   *
   * Why this matters: an OAuth MCP client refreshes its access token when it
   * expires (`offline_access` scope, RFC 6749 refresh-token grant). The fresh
   * bearer arrives on the next `POST /mcp` request, AuthGuard validates it,
   * and the controller mutates `session.accessTokenRef.current` before
   * dispatching to `transport.handleRequest`. If the tool dispatch closure
   * captures the initial token by value, every downstream Gateway call
   * within that session uses a stale bearer and Gateway returns 401 —
   * exactly the symptom users hit after ~15 minutes of conversation.
   */
  it('tools/call dispatches with the LATEST accessToken when the session ref is updated post-creation', async () => {
    const runMock = jest.fn(async () => 'ok');
    registry.register({
      name: 'ctx-token-refresh',
      description: 'ctx',
      inputSchema: { type: 'object' },
      run: runMock,
    });

    const { id } = await svc.createSession('initial-tok', 'user-x');
    const session = store.get(id);
    expect(session).toBeDefined();

    // Simulate Claude Code refreshing its OAuth bearer mid-session: the
    // controller fast path updates the session's mutable token holder
    // before dispatching the next tools/call.
    session!.accessTokenRef.current = 'rotated-tok';

    const server = serverInstances[serverInstances.length - 1];
    const [, callHandler] = server.setRequestHandler.mock.calls[1];
    await callHandler({
      params: { name: 'ctx-token-refresh', arguments: {} },
    });

    expect(runMock).toHaveBeenCalledWith(
      {},
      { userId: 'user-x', accessToken: 'rotated-tok' },
    );
  });

  describe('adoptSession', () => {
    it('returns the given sessionId and stores the session', async () => {
      const { id } = await svc.adoptSession('existing-sid', 'tok-1', 'user-1');

      expect(id).toBe('existing-sid');
      const session = store.get('existing-sid');
      expect(session).toBeDefined();
      expect(session!.userId).toBe('user-1');
      expect(session!.accessToken).toBe('tok-1');
    });

    it('pre-initializes the transport (_initialized=true, sessionId set)', async () => {
      await svc.adoptSession('my-sid', 'tok', 'u');

      const transport = transportInstances[transportInstances.length - 1];
      expect(transport._webStandardTransport._initialized).toBe(true);
      expect(transport._webStandardTransport.sessionId).toBe('my-sid');
    });

    it('registers tools/list, tools/call, prompts/list, and prompts/get handlers on the server', async () => {
      registerPrompt();
      await svc.adoptSession('sid', 't', 'u');

      const server = serverInstances[serverInstances.length - 1];
      expect(server.setRequestHandler).toHaveBeenCalledTimes(4);
      const schemas = server.setRequestHandler.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(new Set(schemas).size).toBe(4);
    });

    it('tools/call dispatches with the adoptSession userId+accessToken context', async () => {
      const runMock = jest.fn(async () => 'adoption-result');
      registry.register({
        name: 'ctx-check',
        description: 'checks context',
        inputSchema: { type: 'object' },
        run: runMock,
      });

      await svc.adoptSession('sid2', 'adopted-tok', 'adopted-user');

      const server = serverInstances[serverInstances.length - 1];
      const [, callHandler] = server.setRequestHandler.mock.calls[1];
      await callHandler({ params: { name: 'ctx-check', arguments: {} } });

      expect(runMock).toHaveBeenCalledWith(
        {},
        { userId: 'adopted-user', accessToken: 'adopted-tok' },
      );
    });
  });

  // The MCP client (Claude Code, Cursor…) names itself once, in `initialize`.
  // Tools such as `cybe_scan_diff` record which AI coding agent asked for an
  // action, so the name must reach every tools/call of the session — on the
  // pod that saw `initialize` and on a sibling pod that adopted the session.
  describe('client name declared at initialize', () => {
    function registerContextProbe(name: string) {
      const runMock = jest.fn(async () => 'ok');
      registry.register({
        name,
        description: 'ctx',
        inputSchema: { type: 'object' },
        run: runMock,
      });
      return runMock;
    }

    async function callTool(name: string) {
      const server = serverInstances[serverInstances.length - 1];
      const [, callHandler] = server.setRequestHandler.mock.calls[1];
      await callHandler({ params: { name, arguments: {} } });
    }

    it('createSession keeps the client name on the session and in the tool context', async () => {
      const runMock = registerContextProbe('ctx-client');

      const { id } = await svc.createSession('tok', 'user-1', 'claude-code');
      await callTool('ctx-client');

      expect(store.get(id)!.clientName).toBe('claude-code');
      expect(runMock).toHaveBeenCalledWith(
        {},
        { userId: 'user-1', accessToken: 'tok', clientName: 'claude-code' },
      );
    });

    it('adoptSession restores the client name recorded by the pod that saw initialize', async () => {
      const runMock = registerContextProbe('ctx-adopted-client');

      await svc.adoptSession('sid-x', 'tok', 'user-2', 'cursor-vscode');
      await callTool('ctx-adopted-client');

      expect(store.get('sid-x')!.clientName).toBe('cursor-vscode');
      expect(runMock).toHaveBeenCalledWith(
        {},
        { userId: 'user-2', accessToken: 'tok', clientName: 'cursor-vscode' },
      );
    });
  });
});
