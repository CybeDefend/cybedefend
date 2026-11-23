import { Injectable } from '@nestjs/common';

import { McpPromptDefinition } from './types';

/**
 * DI-provided catalog of MCP prompts (analogous to {@link import('../tools/registry').ToolRegistry}).
 *
 * Feature modules register prompts in
 * `onModuleInit`. The MCP server consumes `all()` to implement
 * `prompts/list` and dispatches `prompts/get` by name via `get(name)`.
 *
 * Like the `ToolRegistry`, this is intentionally a Nest provider rather
 * than a static singleton: it lets specs construct isolated instances and
 * lets the Nest container control lifetime.
 */
@Injectable()
export class PromptRegistry {
  private readonly prompts: McpPromptDefinition[] = [];

  /**
   * Register a prompt. Throws on duplicate `name` so accidental double-
   * registration is surfaced at bootstrap rather than at call time.
   */
  register(prompt: McpPromptDefinition): void {
    if (this.prompts.some((p) => p.name === prompt.name)) {
      throw new Error(`Prompt "${prompt.name}" is already registered.`);
    }
    this.prompts.push(prompt);
  }

  /**
   * Read-only snapshot of the current prompt catalog in registration order.
   */
  all(): ReadonlyArray<McpPromptDefinition> {
    return this.prompts;
  }

  /**
   * Look up a prompt by name; returns `undefined` if absent so callers can
   * choose how to surface the miss (e.g. throw with a helpful message).
   */
  get(name: string): McpPromptDefinition | undefined {
    return this.prompts.find((p) => p.name === name);
  }
}
