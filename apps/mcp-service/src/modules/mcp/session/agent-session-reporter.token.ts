/**
 * DI token of the per-tool-call session reporter. A string: the cloud
 * edition provides it; in community mode nothing
 * does, and `McpService` serves tool calls without it.
 */
export const AGENT_SESSION_REPORTER = 'AGENT_SESSION_REPORTER';

/** What `McpService` hands every tool call of a session to. */
export interface ToolCallReporter {
  reportToolCall(call: {
    sessionId: string;
    args: Record<string, unknown>;
    accessToken: string;
    clientName?: string;
  }): void;
}
