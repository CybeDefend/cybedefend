/**
 * Protocol behaviour of {@link buildMcpServer}, driven by the real SDK client
 * over an in-memory transport (no mock of the SDK): advertised capabilities,
 * the tool list, argument validation and JSON-RPC error codes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolResultSchema,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'nestjs-pino';

import { PromptRegistry } from '../prompts/registry';
import { ToolRegistry } from '../tools/registry';
import type { McpToolDefinition } from '../tools/types';
import { InvalidArgumentError, NotFoundError } from '../tools/errors';
import { buildMcpServer } from './mcp-server.factory';
import { UUID_PATTERN } from '../tools/schema-parts';

function makeLogger(): Logger & {
  log: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger & {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
}

const ECHO: McpToolDefinition = {
  name: 'echo',
  description: 'Echo the arguments.',
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      teamId: { type: 'string', pattern: UUID_PATTERN },
      severity: {
        type: 'array',
        items: { type: 'string', enum: ['critical', 'high'] },
      },
    },
    required: ['projectId'],
  },
  run: async (args) => ({ args }),
};

async function connect(
  registry: ToolRegistry,
  options: { prompts?: PromptRegistry; logger?: Logger } = {},
): Promise<{ client: Client; server: Server }> {
  const server = buildMcpServer(
    registry,
    'user-1',
    () => 'tok',
    options.logger ?? makeLogger(),
    options.prompts,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'spec', version: '1.0.0' });
  await client.connect(clientSide);
  return { client, server };
}

describe('buildMcpServer — protocol', () => {
  let registry: ToolRegistry;
  let open: { client: Client; server: Server }[];

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(ECHO);
    open = [];
  });

  afterEach(async () => {
    for (const { client, server } of open) {
      await client.close();
      await server.close();
    }
  });

  async function start(options?: {
    prompts?: PromptRegistry;
    logger?: Logger;
  }) {
    const pair = await connect(registry, options);
    open.push(pair);
    return pair.client;
  }

  describe('capabilities', () => {
    it('does not advertise prompts when no prompt is registered', async () => {
      const client = await start({ prompts: new PromptRegistry() });

      expect(client.getServerCapabilities()?.prompts).toBeUndefined();
      expect(client.getServerCapabilities()?.tools).toBeDefined();
    });

    it('advertises prompts when one is registered', async () => {
      const prompts = new PromptRegistry();
      prompts.register({
        name: 'p',
        description: 'p',
        arguments: [],
        render: async () => ({ messages: [] }),
      });
      const client = await start({ prompts });

      expect(client.getServerCapabilities()?.prompts).toBeDefined();
      expect((await client.listPrompts()).prompts).toHaveLength(1);
    });
  });

  describe('tools/list', () => {
    it("lists each tool's annotations and its input schema as declared", async () => {
      const client = await start();

      const { tools } = await client.listTools();

      expect(tools[0].annotations).toEqual({ readOnlyHint: true });
      expect(tools[0].inputSchema).toEqual(ECHO.inputSchema);
    });
  });

  describe('tools/call', () => {
    it('answers -32602 Invalid params to a malformed tools/call request', async () => {
      const client = await start();

      for (const params of [
        { name: 'echo', arguments: 'x' },
        { arguments: {} },
      ]) {
        await expect(
          client.request(
            { method: 'tools/call', params } as never,
            CallToolResultSchema,
          ),
        ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
      }
    });

    it('refuses arguments that break the input schema, before the tool runs', async () => {
      const run = jest.fn(async () => 'ran');
      registry = new ToolRegistry();
      registry.register({ ...ECHO, run });
      const logger = makeLogger();
      const client = await start({ logger });

      for (const args of [
        { projectId: 'p', severity: ['bogus'] },
        {},
        { projectId: 42 },
        { projectId: 'p', teamId: '../../organizations' },
      ]) {
        const result = await client.callTool({ name: 'echo', arguments: args });
        expect(result.isError).toBe(true);
        const payload = JSON.parse(
          (result.content as { text: string }[])[0].text,
        );
        expect(payload.code).toBe('INVALID_ARGUMENT');
        expect(payload.message).toMatch(/^Invalid arguments for echo: /);
      }
      expect(run).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(String(logger.warn.mock.calls)).not.toContain('    at ');
    });

    it('names the offending argument in the refusal', async () => {
      const client = await start();

      const result = await client.callTool({
        name: 'echo',
        arguments: { projectId: 'p', severity: ['bogus'] },
      });

      expect((result.content as { text: string }[])[0].text).toContain(
        'severity',
      );
    });

    it('ignores undeclared arguments: the tool runs without them', async () => {
      const run = jest.fn(async (args: Record<string, unknown>) => ({ args }));
      const onToolCall = jest.fn();
      registry = new ToolRegistry();
      registry.register({ ...ECHO, run });
      const server = buildMcpServer(
        registry,
        'user-1',
        () => 'tok',
        makeLogger(),
        undefined,
        undefined,
        onToolCall,
      );
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const client = new Client({ name: 'spec', version: '1.0.0' });
      await client.connect(clientSide);
      open.push({ client, server });

      const result = await client.callTool({
        name: 'echo',
        arguments: { projectId: 'p', evil: 1, clientHint: { x: 1 } },
      });

      expect(result.isError).toBeUndefined();
      expect(run).toHaveBeenCalledWith({ projectId: 'p' }, expect.anything());
      expect(onToolCall).toHaveBeenCalledWith({ projectId: 'p' }, 'tok');
    });

    it('ignores undeclared arguments even when the schema says additionalProperties: false', async () => {
      const run = jest.fn(async (args: Record<string, unknown>) => ({ args }));
      registry = new ToolRegistry();
      registry.register({
        ...ECHO,
        inputSchema: { ...ECHO.inputSchema, additionalProperties: false },
        run,
      });
      const client = await start();

      const result = await client.callTool({
        name: 'echo',
        arguments: { projectId: 'p', evil: 1 },
      });

      expect(result.isError).toBeUndefined();
      expect(run).toHaveBeenCalledWith({ projectId: 'p' }, expect.anything());
    });

    it('lets the reserved retry keys through on any tool', async () => {
      const client = await start();

      const result = await client.callTool({
        name: 'echo',
        arguments: { projectId: 'p', idempotencyKey: 'k', toolCallId: 'c' },
      });

      expect(result.isError).toBeUndefined();
      expect(
        JSON.parse((result.content as { text: string }[])[0].text).args,
      ).toEqual({ projectId: 'p', idempotencyKey: 'k', toolCallId: 'c' });
    });

    it('runs the tool with valid arguments', async () => {
      const client = await start();

      const result = await client.callTool({
        name: 'echo',
        arguments: { projectId: 'p', severity: ['critical'] },
      });

      expect(result.isError).toBeUndefined();
    });

    it('logs expected client errors as a warning without stack, and failures as errors', async () => {
      registry = new ToolRegistry();
      registry.register({
        ...ECHO,
        name: 'refuses',
        run: async () => {
          throw new InvalidArgumentError('projectId', 'nope');
        },
      });
      registry.register({
        ...ECHO,
        name: 'missing',
        run: async () => {
          throw new NotFoundError('Project', 'p');
        },
      });
      registry.register({
        ...ECHO,
        name: 'upstream400',
        run: async () => {
          throw Object.assign(new Error('bad'), { response: { status: 400 } });
        },
      });
      registry.register({
        ...ECHO,
        name: 'breaks',
        run: async () => {
          throw new Error('boom');
        },
      });
      const logger = makeLogger();
      const client = await start({ logger });

      for (const name of ['refuses', 'missing', 'upstream400']) {
        await client.callTool({ name, arguments: { projectId: 'p' } });
      }
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledTimes(3);
      expect(String(logger.warn.mock.calls)).not.toContain('    at ');

      await client.callTool({ name: 'breaks', arguments: { projectId: 'p' } });
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
