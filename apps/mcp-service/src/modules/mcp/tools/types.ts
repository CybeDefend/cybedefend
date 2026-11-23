import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Tool execution context forwarded by `McpService` on every `tools/call`.
 *
 * Authorisation is not represented here: every MCP tool forwards to
 * Gateway, which point-checks Permify on each REST endpoint. The user
 * identity (`userId`) and the raw Logto bearer (`accessToken`) are all
 * a tool needs to act on the user's behalf.
 *
 * `clientName` is the name the MCP client declared in `initialize`
 * (`claude-code`, `cursor-vscode`…): which AI coding agent is calling. It is
 * a display label only — any client can claim any name.
 */
export interface ToolContext {
  userId: string;
  accessToken: string;
  clientName?: string;
}

/**
 * Contract every MCP tool must satisfy.
 *
 * Tools are registered into the DI-provided `ToolRegistry` by their owning
 * feature modules; the MCP server enumerates them via `tools/list` and
 * dispatches `tools/call` via `ToolRegistry.all()`.
 *
 * Fields:
 *  - `name` — unique MCP tool identifier (e.g. `list_projects`).
 *  - `description` — human-readable summary shown to AI clients.
 *  - `inputSchema` — JSON Schema describing the expected `arguments` payload.
 *    It is enforced before `run`: a call whose arguments break it is refused
 *    as an invalid argument. A top-level argument it does not declare is
 *    dropped (never passed to `run`), unless the schema allows extra
 *    properties with a non-false `additionalProperties`.
 *  - `annotations` — MCP behaviour hints (`readOnlyHint`, `destructiveHint`,
 *    `idempotentHint`, `openWorldHint`) clients use to decide when to ask
 *    the user before a call.
 *  - `run` — handler invoked on `tools/call`; receives the parsed `arguments`
 *    object plus the authenticated user context forwarded by `McpService`.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  run(args: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}
