/**
 * Contract every MCP prompt must satisfy.
 *
 * Prompts are registered into the DI-provided `PromptRegistry` by their
 * owning feature modules; the MCP server enumerates them via `prompts/list`
 * and dispatches `prompts/get` via `PromptRegistry.get(name)`.
 *
 * `arguments` is the JSON-spec-style argument list shown to MCP clients —
 * each entry is `{ name, description?, required? }`. The `render` callback
 * receives a flat `Record<string, string>` of argument values supplied by
 * the client and must return one or more chat messages.
 */
export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface McpPromptRenderResult {
  messages: McpPromptMessage[];
  description?: string;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
  render: (args: Record<string, string>) => Promise<McpPromptRenderResult>;
}
