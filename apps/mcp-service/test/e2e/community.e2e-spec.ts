/**
 * End-to-end proof of the Community Edition of mcp-service.
 *
 * Boots the real {@link AppModule} on Fastify with CYBEDEFEND_EDITION set to
 * `community` BEFORE AppModule is loaded (editionImports() runs when its
 * @Module decorator is evaluated), and with no Logto and no secret-store
 * variable. A `node:http` fake gateway stands in for the CybeDefend API: it
 * records what mcp-service sends and refuses one token with 401.
 *
 * Asserted: the bearer challenge without OAuth discovery, a `cdp_` personal
 * access token checked once against the gateway and opening a session, the
 * 21 AppSec tools and no prompt, the token forwarded verbatim to the gateway,
 * a token the gateway refuses answered 401 before any session exists, and no
 * log line carrying the token.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const PUBLIC_URL = 'http://localhost:3010';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('LOGTO_')) {
    delete process.env[key];
  }
}
delete process.env.REDIS_URL;
process.env.CYBEDEFEND_EDITION = 'community';
process.env.PUBLIC_URL = PUBLIC_URL;
process.env.OTEL_DISABLED = 'true';
// CYBEDEFEND_API_RESOURCE is set in beforeAll, once the fake gateway listens.

// `jose@6` ships only as native ESM, which Jest's CJS runtime cannot load.
// The community graph never verifies a JWT; the private tree still loads the
// cloud bindings through ee-modules.ts, so a stub keeps both trees loading.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

import { Logger, ValidationPipe, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';

import { GlobalExceptionFilter } from '../../src/core/exception/global-exception.filter';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

/** The 21 AppSec tools of the core. */
const COMMUNITY_TOOLS = [
  'list_organizations',
  'search_projects',
  'list_teams',
  'create_project',
  'get_project_overview',
  'get_branches',
  'get_user_posture',
  'list_vulnerabilities_sast',
  'get_vulnerability_sast',
  'list_vulnerabilities_sca',
  'get_vulnerability_sca',
  'list_vulnerabilities_iac',
  'get_vulnerability_iac',
  'list_vulnerabilities_cicd',
  'get_vulnerability_cicd',
  'list_vulnerabilities_secret',
  'get_vulnerability_secret',
  'list_vulnerabilities_container',
  'get_vulnerability_container',
  'update_vulnerability',
  'set_exploitability',
];

// Two well-formed personal access tokens: the fake gateway accepts the first
// and refuses the second, as it would an unknown or revoked one.
const TOKEN = 'cdp_' + 'A'.repeat(43);
const REFUSED_TOKEN = 'cdp_' + 'R'.repeat(43);

interface Recorded {
  method: string;
  url: string;
  authorization: string | undefined;
}

type Injected = Awaited<ReturnType<NestFastifyApplication['inject']>>;

interface JsonRpcAnswer {
  jsonrpc: '2.0';
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'community-e2e', version: '1.0.0' },
  },
};

/** The JSON-RPC answer of a Streamable HTTP response (JSON or SSE). */
function answerOf(res: Injected): JsonRpcAnswer {
  const type = String(res.headers['content-type'] ?? '');
  if (type.includes('text/event-stream')) {
    const data = res.body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .pop();
    return JSON.parse(data!) as JsonRpcAnswer;
  }
  return res.json<JsonRpcAnswer>();
}

describe('mcp-service e2e in community mode', () => {
  let app: NestFastifyApplication;
  let gateway: Server;
  const recorded: Recorded[] = [];
  const output: string[] = [];
  const spies: jest.SpyInstance[] = [];
  let nextId = 2;

  beforeAll(async () => {
    gateway = createServer((req: IncomingMessage, res) => {
      recorded.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
      });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization === `Bearer ${REFUSED_TOKEN}`) {
        res.statusCode = 401;
        res.end(
          JSON.stringify({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid token',
          }),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/user/profile') {
        res.end(JSON.stringify({ email: 'user@example.com' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/organizations') {
        res.end(JSON.stringify([{ id: 'o1', name: 'Acme' }]));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ statusCode: 404, message: 'Not Found' }));
    });
    await new Promise<void>((resolve) =>
      gateway.listen(0, '127.0.0.1', resolve),
    );
    const { port } = gateway.address() as AddressInfo;
    process.env.CYBEDEFEND_API_RESOURCE = `http://127.0.0.1:${port}`;

    // Every line written by the service, to prove the token is never in one.
    const capture =
      (sink: string[]) =>
      (...args: unknown[]): boolean => {
        sink.push(args.map((a) => String(a)).join(' '));
        return true;
      };
    spies.push(
      jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(capture(output) as never),
      jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(capture(output) as never),
    );
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      for (const logger of [Logger.prototype, PinoLogger.prototype]) {
        spies.push(
          jest
            .spyOn(logger, level)
            .mockImplementation(capture(output) as never),
        );
      }
    }

    // Loaded only now: the edition and the gateway URL are read at import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../src/app.module') as {
      AppModule: Type<unknown>;
    };
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    for (const spy of spies) {
      spy.mockRestore();
    }
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
  });

  /** Opens a session with `token` and returns its id. */
  async function openSession(token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
      payload: INITIALIZE,
    });
    expect(res.statusCode).toBe(200);
    expect(answerOf(res).result).toBeDefined();
    const sessionId = res.headers['mcp-session-id'] as string;
    expect(sessionId).toEqual(expect.any(String));
    const initialized = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...MCP_HEADERS,
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    expect(initialized.statusCode).toBe(202);
    return sessionId;
  }

  async function rpc(
    token: string,
    sessionId: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JsonRpcAnswer> {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...MCP_HEADERS,
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
      },
      payload: { jsonrpc: '2.0', id: nextId++, method, params },
    });
    expect(res.statusCode).toBe(200);
    return answerOf(res);
  }

  it('boots without any Logto variable', () => {
    expect(
      Object.keys(process.env).filter((key) => key.startsWith('LOGTO_')),
    ).toEqual([]);
    expect(app).toBeDefined();
  });

  it('answers 401 with WWW-Authenticate: Bearer when no bearer is sent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: INITIALIZE,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('answers 401 invalid_token to a JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...MCP_HEADERS,
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.x',
      },
      payload: INITIALIZE,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it('opens a session with a cdp_ token and lists the 21 AppSec tools', async () => {
    const sessionId = await openSession(TOKEN);
    const answer = await rpc(TOKEN, sessionId, 'tools/list');
    const names = (answer.result!.tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    );
    expect(names).toHaveLength(21);
    expect([...names].sort()).toEqual([...COMMUNITY_TOOLS].sort());
  });

  it('forwards the cdp_ token verbatim to the gateway on a tool call', async () => {
    const sessionId = await openSession(TOKEN);
    recorded.length = 0;
    const answer = await rpc(TOKEN, sessionId, 'tools/call', {
      name: 'list_organizations',
      arguments: {},
    });
    expect(answer.result!.isError).toBeFalsy();
    expect(recorded).toEqual([
      {
        method: 'GET',
        url: '/organizations',
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
  });

  it('checks a new token against the gateway once, not on every call', async () => {
    const fresh = 'cdp_' + 'F'.repeat(43);
    recorded.length = 0;
    const sessionId = await openSession(fresh);
    await rpc(fresh, sessionId, 'tools/list');
    expect(recorded.filter((call) => call.url === '/user/profile')).toEqual([
      {
        method: 'GET',
        url: '/user/profile',
        authorization: `Bearer ${fresh}`,
      },
    ]);
  });

  it('answers 401 before any session exists to a token the gateway refuses', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${REFUSED_TOKEN}` },
      payload: INITIALIZE,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer error="invalid_token"',
    );
    expect(res.headers['mcp-session-id']).toBeUndefined();
    // Not vacuous: the gateway was asked.
    expect(recorded).toContainEqual({
      method: 'GET',
      url: '/user/profile',
      authorization: `Bearer ${REFUSED_TOKEN}`,
    });
    for (const line of output) {
      expect(line).not.toContain(REFUSED_TOKEN);
      expect(line).not.toContain(TOKEN);
    }
  });

  it('serves no OAuth discovery route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns an empty prompt list', async () => {
    const sessionId = await openSession(TOKEN);
    const answer = await rpc(TOKEN, sessionId, 'prompts/list');
    expect(answer.error).toBeUndefined();
    expect(answer.result!.prompts).toEqual([]);
  });
});
