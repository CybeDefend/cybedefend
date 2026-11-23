/**
 * Specs for the `tools/call` hook of {@link buildMcpServer} that lets the
 * session report itself (an edition's « active sessions »): it sees each call
 * of a known tool with the current bearer, and nothing it does can fail or
 * delay the tool.
 */

type Handler = (req: unknown) => Promise<unknown>;
const serverInstances: { handlers: Map<unknown, Handler> }[] = [];

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => {
    const handlers = new Map<unknown, Handler>();
    const instance = {
      handlers,
      setRequestHandler: jest.fn((schema: unknown, handler: Handler) => {
        handlers.set(schema, handler);
      }),
    };
    serverInstances.push(instance);
    return instance;
  }),
}));

import type { Logger } from 'nestjs-pino';

import { ToolRegistry } from '../tools/registry';
import { toolsCallHandlerOf } from '../tools/__test-utils__/tools-call-handler';
import { McpToolError } from '../tools/errors';
import { buildMcpServer } from './mcp-server.factory';

function makeLogger(): Logger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function callTool(name: string, args: Record<string, unknown>) {
  const handler = toolsCallHandlerOf(serverInstances[0].handlers);
  return handler({
    method: 'tools/call',
    params: { name, arguments: args },
  }) as Promise<{
    content: { text: string }[];
    isError?: boolean;
  }>;
}

describe('buildMcpServer — tool-call hook', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    serverInstances.length = 0;
    registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'echo',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
      },
      run: async (args) => ({ echoed: args.projectId }),
    });
  });

  it('passes each call of a known tool to the hook with its arguments and the current bearer', async () => {
    const onToolCall = jest.fn();
    let token = 'first';
    buildMcpServer(
      registry,
      'user-1',
      () => token,
      makeLogger(),
      undefined,
      'claude-code',
      onToolCall,
    );

    await callTool('echo', { projectId: 'p' });
    token = 'refreshed';
    await callTool('echo', { projectId: 'q' });

    expect(onToolCall.mock.calls).toEqual([
      [{ projectId: 'p' }, 'first'],
      [{ projectId: 'q' }, 'refreshed'],
    ]);
  });

  it('does not call the hook for an unknown tool', async () => {
    const onToolCall = jest.fn();
    buildMcpServer(
      registry,
      'u',
      () => 't',
      makeLogger(),
      undefined,
      undefined,
      onToolCall,
    );

    const result = await callTool('nope', { projectId: 'p' });

    expect(result.isError).toBe(true);
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('returns the tool result when the hook throws', async () => {
    buildMcpServer(
      registry,
      'u',
      () => 't',
      makeLogger(),
      undefined,
      undefined,
      () => {
        throw new Error('report broke');
      },
    );

    const result = await callTool('echo', { projectId: 'p' });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ echoed: 'p' });
  });

  it('works without a hook', async () => {
    buildMcpServer(registry, 'u', () => 't', makeLogger());

    const result = await callTool('echo', { projectId: 'p' });

    expect(JSON.parse(result.content[0].text)).toEqual({ echoed: 'p' });
  });
});

describe('buildMcpServer — expected outcomes', () => {
  beforeEach(() => {
    serverInstances.length = 0;
  });

  it('logs an expected outcome as a warning without stack, never an error', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 't',
      description: 't',
      inputSchema: { type: 'object' },
      run: async () => {
        throw Object.assign(
          new McpToolError('SOME_CODE', 'm', { unit: 'u', reason: 'r' }),
          { expectedOutcome: true },
        );
      },
    });
    const logger = makeLogger();
    buildMcpServer(registry, 'u-1', () => 'tok', logger);

    const result = await callTool('t', {});

    expect(result.isError).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    const warns = JSON.stringify((logger.warn as jest.Mock).mock.calls);
    expect(warns).toContain('Tool t blocked [SOME_CODE]');
    expect(warns).toContain('unit=u reason=r');
  });
});
