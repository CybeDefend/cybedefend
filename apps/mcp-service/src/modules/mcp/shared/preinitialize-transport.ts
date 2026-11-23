import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Mark a freshly-built transport as already initialized so an adopted
 * cross-pod session can skip the `initialize` round-trip the client has
 * already completed on a sibling pod.
 *
 * The SDK's `WebStandardStreamableHTTPServerTransport` guards every
 * non-initialize request behind `_initialized` and `sessionId` checks. No
 * public API exists to mark a transport as pre-initialized, so we reach
 * into the private `_webStandardTransport` field. SDK is pinned to 1.29.0
 * in package.json while this is in place — bumps must verify the field
 * still exists and still gates the same way.
 */
export function preInitializeTransport(
  transport: StreamableHTTPServerTransport,
  sessionId: string,
): void {
  const inner = (transport as any)._webStandardTransport;
  if (!inner) {
    throw new Error(
      'preInitializeTransport: _webStandardTransport is missing — verify SDK version compatibility (pinned to 1.29.0)',
    );
  }
  inner._initialized = true;
  inner.sessionId = sessionId;
}
