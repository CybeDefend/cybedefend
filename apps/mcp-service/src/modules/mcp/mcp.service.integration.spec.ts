/**
 * Integration specs for `McpService.adoptSession`.
 *
 * Uses REAL MCP SDK `Server` and `StreamableHTTPServerTransport` (no mocks)
 * to verify that `preInitialize` correctly sets the transport's internal
 * state so a `tools/call` request is accepted without a prior `initialize`
 * round-trip.
 *
 * This catches regressions from SDK upgrades that rename or restructure
 * `_webStandardTransport` (the private field `preInitialize` accesses).
 */
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import * as http from 'node:http';
import { McpService } from './mcp.service';
import { PromptRegistry } from './prompts/registry';
import { InMemorySessionStore } from './session/session.store';
import { SESSION_STORE } from './session/session-store.interface';
import { ToolRegistry } from './tools/registry';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** Spin up a throw-away HTTP server, send one JSON-RPC request, return the response body string. */
async function sendRequest(
  transport: StreamableHTTPServerTransport,
  sessionId: string,
  body: unknown,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        await transport.handleRequest(req, res, body);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const bodyStr = JSON.stringify(body);

      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: addr.port,
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          'mcp-protocol-version': '2024-11-05',
        },
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          server.close();
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        res.on('error', (e) => {
          server.close();
          reject(e);
        });
      });

      req.on('error', (e) => {
        server.close();
        reject(e);
      });
      req.write(bodyStr);
      req.end();
    });

    server.on('error', reject);
  });
}

describe('McpService.adoptSession (integration — real SDK)', () => {
  let svc: McpService;
  let store: InMemorySessionStore;
  let registry: ToolRegistry;

  beforeEach(async () => {
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
  });

  afterEach(() => {
    store.stop();
  });

  it('adopted transport accepts tools/list without a prior initialize', async () => {
    registry.register({
      name: 'ping',
      description: 'returns pong',
      inputSchema: { type: 'object', properties: {} },
      run: async () => 'pong',
    });

    const { transport } = await svc.adoptSession('test-sid', 'tok', 'u1');

    const body = await sendRequest(transport, 'test-sid', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    expect(body).toContain('"tools"');
    expect(body).toContain('"ping"');
    expect(body).not.toContain('"error"');
  });

  it('adopted transport accepts tools/call without a prior initialize', async () => {
    registry.register({
      name: 'echo',
      description: 'echoes input',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
      run: async (args) => (args as any).msg,
    });

    const { transport } = await svc.adoptSession('test-sid-2', 'tok', 'u1');

    const body = await sendRequest(transport, 'test-sid-2', {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { msg: 'hello' } },
    });

    expect(body).toContain('hello');
    expect(body).not.toContain('"error"');
  });
});
