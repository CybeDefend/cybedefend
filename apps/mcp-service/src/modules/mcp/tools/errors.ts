/**
 * Typed MCP tool errors.
 *
 * The MCP handler maps any thrown error into a JSON payload so the
 * Python agent / dashboard can show a meaningful UI (red bubble +
 * translated message) instead of a raw stack trace. The canonical
 * codes live in {@link MCP_ERROR_CODES}; tools should throw one of
 * the typed subclasses below rather than a bare `Error` whenever the
 * failure mode is well-known.
 */

export const MCP_ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  // Only `create_project` uses these two (Gateway 409 / 429 on
  // creation); the global error mapper still sends both statuses as INTERNAL.
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  UNAVAILABLE: 'UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type McpErrorCode =
  (typeof MCP_ERROR_CODES)[keyof typeof MCP_ERROR_CODES];

export interface McpErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class McpToolError extends Error {
  /**
   * An expected outcome (e.g. a product-specific refusal the edition layer
   * recognises) is reported to the agent in fixed text and logged as a
   * warning without stack, never as an error. Default false.
   */
  expectedOutcome = false;

  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'McpToolError';
  }

  toPayload(): McpErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class PermissionDeniedError extends McpToolError {
  constructor(public readonly projectId: string) {
    super(
      MCP_ERROR_CODES.PERMISSION_DENIED,
      `Project ${projectId} not in accessible_project_ids`,
      { projectId },
    );
    this.name = 'PermissionDeniedError';
  }
}

export class NotFoundError extends McpToolError {
  constructor(resource: string, id: string) {
    super(MCP_ERROR_CODES.NOT_FOUND, `${resource} ${id} not found`, {
      resource,
      id,
    });
    this.name = 'NotFoundError';
  }
}

export class InvalidArgumentError extends McpToolError {
  constructor(argument: string, reason: string) {
    super(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      `Invalid argument '${argument}': ${reason}`,
      { argument, reason },
    );
    this.name = 'InvalidArgumentError';
  }
}

export class UnavailableError extends McpToolError {
  constructor(service: string, extra?: Record<string, unknown>) {
    super(MCP_ERROR_CODES.UNAVAILABLE, `Service ${service} is unavailable`, {
      service,
      ...(extra ?? {}),
    });
    this.name = 'UnavailableError';
  }
}

export class InternalMcpError extends McpToolError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(MCP_ERROR_CODES.INTERNAL, message, details);
    this.name = 'InternalMcpError';
  }
}
