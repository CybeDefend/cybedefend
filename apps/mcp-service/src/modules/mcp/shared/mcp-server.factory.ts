import { Logger } from 'nestjs-pino';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  type CallToolRequest,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ToolRegistry } from '../tools/registry';
import { PromptRegistry } from '../prompts/registry';
import { mapErrorToPayload } from './error-mapper';
import { MCP_ERROR_CODES, McpToolError } from '../tools/errors';
import { prepareToolArguments } from './tool-input';

/**
 * `tools/call` is registered under this loose schema, not the SDK's
 * `CallToolRequestSchema`: the SDK's `Server` then checks the request against
 * `CallToolRequestSchema` itself and answers a malformed one (`arguments`
 * that are not an object, no `name`) with -32602 Invalid params. Registered
 * under the strict schema, the parse failure surfaced as -32603 Internal
 * error with a schema dump.
 */
const LooseCallToolRequestSchema = z.looseObject({
  method: z.literal('tools/call'),
});

/**
 * Error codes that describe the caller's request (a refusal it can act on),
 * not a failure of this service or of an upstream one. They are logged as a
 * warning without stack.
 */
const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  MCP_ERROR_CODES.UNAUTHENTICATED,
  MCP_ERROR_CODES.PERMISSION_DENIED,
  MCP_ERROR_CODES.NOT_FOUND,
  MCP_ERROR_CODES.INVALID_ARGUMENT,
  MCP_ERROR_CODES.ALREADY_EXISTS,
  MCP_ERROR_CODES.RESOURCE_EXHAUSTED,
]);

/**
 * Build a fully-wired MCP `Server` (with `ListTools` + `CallTool` handlers)
 * for one session. Each call returns a fresh `Server` instance; the caller
 * owns lifecycle (transport connect, session-store insert).
 *
 * `getAccessToken` is a getter, not a value — it MUST read the current
 * bearer at the moment of tool dispatch, not when the server is built.
 * The session controller mutates the holder behind the getter every time
 * an authenticated request comes in; if we captured a string by value
 * here, refreshed tokens from Claude Code would never reach the Gateway
 * call layer and tools would 401 ~15 min into a session.
 *
 * On tool errors we return an `isError: true` content block rather than
 * throwing — that keeps the JSON-RPC stream alive and matches the MCP
 * SDK's recommended tool error shape.
 *
 * `clientName` is the name the client declared in `initialize`; it never
 * changes for the life of the session, so a value is enough.
 *
 * `onToolCall`, when given, sees every call of a known tool with its
 * arguments and the bearer of that call, before the tool runs: the session
 * uses it to report itself to Gateway (an edition's « active sessions »). It
 * must return at once (fire-and-forget); a throw is swallowed so that it can
 * never fail a tool call.
 *
 * `instructions`, when given, is the `instructions` string of the
 * `initialize` response (the edition's `MCP_EDITION_TEXTS.serverInstructions`).
 */
export function buildMcpServer(
  registry: ToolRegistry,
  userId: string,
  getAccessToken: () => string,
  logger: Logger,
  promptRegistry?: PromptRegistry,
  clientName?: string,
  onToolCall?: (args: Record<string, unknown>, accessToken: string) => void,
  instructions?: string,
): Server {
  // Prompts are advertised only when there is one to list: a client that
  // sees the capability may otherwise offer an empty prompt menu.
  const servesPrompts = !!promptRegistry && promptRegistry.all().length > 0;
  const server = new Server(
    { name: 'cybedefend-mcp', version: '0.4.0' },
    {
      capabilities: servesPrompts ? { tools: {}, prompts: {} } : { tools: {} },
      // MCP spec: every `initialize` response carries this `instructions`
      // string; spec-compliant clients (Cursor / Codex / Windsurf, and
      // Claude Code via system-prompt injection) surface it to the model
      // automatically at session start. This is how non-Claude-Code clients
      // learn the CybeDefend workflow with no bash hook.
      ...(instructions !== undefined ? { instructions } : {}),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry
      .all()
      .map(({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        ...(annotations ? { annotations } : {}),
      })),
  }));

  server.setRequestHandler(LooseCallToolRequestSchema, async (raw) => {
    // The SDK's Server has already checked the request against
    // CallToolRequestSchema (see LooseCallToolRequestSchema).
    const req = raw as unknown as CallToolRequest;
    const tool = registry.all().find((t) => t.name === req.params.name);
    if (!tool) {
      logger.warn(
        `Tool call unknown tool=${JSON.stringify(req.params.name)} userId=${userId}`,
      );
      return {
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    // Per-call outcome telemetry (OTLP backend): successes carry the duration so
    // failures have a denominator — during the August-2026 incident the
    // server logged only thrown errors, so "which tools does client X reach
    // and how often do they fail" was unanswerable from production.
    const startedAt = Date.now();
    const prepared = prepareToolArguments(tool, req.params.arguments ?? {});
    if ('error' in prepared) {
      const invalid = prepared.error;
      logger.warn(
        `Tool ${tool.name} refused [${invalid.code}] userId=${userId}: ${invalid.message}`,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(invalid.toPayload()) }],
        isError: true,
      };
    }
    const args = prepared.args;
    const accessToken = getAccessToken();
    if (onToolCall) {
      try {
        onToolCall(args, accessToken);
      } catch {
        // A session report never fails a tool call.
      }
    }
    try {
      const result = await tool.run(args, {
        userId,
        accessToken,
        ...(clientName ? { clientName } : {}),
      });
      logger.log(
        `Tool ${tool.name} ok in ${Date.now() - startedAt}ms userId=${userId}`,
      );
      return {
        content: [
          {
            type: 'text',
            text:
              typeof result === 'string'
                ? result
                : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const stack = (e as { stack?: string })?.stack;
      const payload = mapErrorToPayload(e);
      if (e instanceof McpToolError && e.expectedOutcome) {
        // An expected outcome (e.g. a product-specific refusal the edition
        // layer recognises) is reported to the agent in fixed text. A
        // warning without stack, so it does not count as a tool failure.
        logger.warn(
          `Tool ${tool.name} blocked [${payload.code}] in ${Date.now() - startedAt}ms userId=${userId} unit=${String(payload.details?.unit)} reason=${String(payload.details?.reason)}`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          isError: true,
        };
      }
      if (CLIENT_ERROR_CODES.has(payload.code)) {
        // A refusal the caller can act on (invalid argument, permission,
        // unknown id…) is not a fault of this service.
        logger.warn(
          `Tool ${tool.name} refused [${payload.code}] in ${Date.now() - startedAt}ms userId=${userId}: ${payload.message}`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          isError: true,
        };
      }
      logger.error(
        `Tool ${tool.name} failed [${payload.code}] in ${Date.now() - startedAt}ms userId=${userId}: ${stack || payload.message}`,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: true,
      };
    }
  });

  // Prompt surface — wired only when a PromptRegistry is supplied (the
  // public `/mcp` surface). `prompts/list` enumerates the registered
  // CybeDefend workflow prompts; `prompts/get` renders one by name.
  if (servesPrompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: promptRegistry
        .all()
        .map(({ name, description, arguments: args }) => ({
          name,
          description,
          arguments: args,
        })),
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      const prompt = promptRegistry.get(req.params.name);
      if (!prompt) {
        throw new Error(`Unknown prompt: ${req.params.name}`);
      }
      const result = await prompt.render(req.params.arguments ?? {});
      return {
        description: result.description ?? prompt.description,
        messages: result.messages,
      };
    });
  }

  return server;
}
