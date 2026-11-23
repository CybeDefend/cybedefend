import {
  MCP_ERROR_CODES,
  McpErrorCode,
  McpErrorPayload,
  McpToolError,
} from '../tools/errors';

/**
 * Map a raw thrown error into a canonical {@link McpErrorPayload}.
 *
 * - `McpToolError` instances are surfaced as-is (typed tool failures).
 * - Axios-shaped errors (`err.response.status`) are mapped by HTTP status
 *   so the dashboard can render a translated message instead of a stack.
 * - Connection-level failures (`ECONNREFUSED`, 5xx) become `UNAVAILABLE`.
 * - Anything else falls back to `INTERNAL` so the UI always sees a code.
 *
 * Shared between `McpService` (public surface) and the upcoming
 * `InternalMcpService` so the error wire shape stays identical across
 * audiences — agents and external clients see the same vocabulary.
 *
 * Security: the upstream response body is NEVER echoed to the
 * caller (the one exception is the validation message of a 400, which
 * `GatewayClientService` extracts as `validationMessage`) — it may contain bearer tokens, encryption keys, or other
 * privileged metadata. We surface `statusText: <status>` instead so
 * clients can still distinguish failure shapes without exposing the
 * upstream payload.
 */
export function mapErrorToPayload(e: unknown): McpErrorPayload {
  if (e instanceof McpToolError) {
    return e.toPayload();
  }

  const err = e as {
    message?: string;
    code?: string;
    response?: { status?: number; data?: unknown };
    validationMessage?: unknown;
  };
  const status = err?.response?.status;
  // Only the numeric status is surfaced — the upstream body is intentionally
  // dropped on the floor to avoid leaking secrets across the trust boundary.
  const details =
    typeof status === 'number' ? { statusText: status } : undefined;

  let code: McpErrorCode;
  let message: string;
  if (status === 401) {
    // Distinct from 403: 401 means the bearer was rejected (expired/revoked
    // signature, audience mismatch, JWKS rotation race), so the UI/agent
    // should prompt re-authentication rather than tell the user they lack
    // permission. The upstream body is dropped (it could carry a
    // leaked refresh_token or kid hint).
    code = MCP_ERROR_CODES.UNAUTHENTICATED;
    message = 'Authentication required';
  } else if (status === 403) {
    code = MCP_ERROR_CODES.PERMISSION_DENIED;
    message = 'Access denied';
  } else if (status === 404) {
    code = MCP_ERROR_CODES.NOT_FOUND;
    message = 'Resource not found';
  } else if (status === 400 || status === 422) {
    code = MCP_ERROR_CODES.INVALID_ARGUMENT;
    // The gateway client keeps the gateway's validation message of a 400
    // (and only that): the agent needs it to correct its call.
    message =
      typeof err.validationMessage === 'string' && err.validationMessage
        ? `Invalid argument: ${err.validationMessage}`
        : 'Invalid argument';
  } else if (
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ETIMEDOUT' ||
    (typeof status === 'number' && status >= 500)
  ) {
    code = MCP_ERROR_CODES.UNAVAILABLE;
    message = 'Upstream service unavailable';
  } else {
    code = MCP_ERROR_CODES.INTERNAL;
    message = String(err?.message ?? e);
  }

  return { code, message, ...(details ? { details } : {}) };
}
