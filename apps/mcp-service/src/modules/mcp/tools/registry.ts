import { Injectable } from '@nestjs/common';
import { McpToolDefinition } from './types';

/**
 * DI-provided catalog of MCP tools.
 *
 * Feature modules (e.g. `security-context`) inject this registry and register
 * their tools in an `onModuleInit` hook. The `McpService` consumes `all()` to
 * implement `tools/list` and to dispatch `tools/call` by `name`.
 *
 * Not a static singleton: this lets specs construct their own isolated
 * instance and lets the Nest container control lifetime.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools: McpToolDefinition[] = [];

  /**
   * Register a tool. Throws on duplicate `name` so accidental double-
   * registration is surfaced at bootstrap rather than at call time.
   */
  register(tool: McpToolDefinition): void {
    if (this.tools.some((t) => t.name === tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.push(tool);
  }

  /**
   * Read-only snapshot of the current tool catalog in registration order.
   */
  all(): ReadonlyArray<McpToolDefinition> {
    return this.tools;
  }
}
