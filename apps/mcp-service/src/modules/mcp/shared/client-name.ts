/**
 * The name an MCP client declares for itself in its `initialize` request
 * (`params.clientInfo.name`): `claude-code`, `cursor-vscode`,
 * `Visual Studio Code`… It is what lets the platform say which AI coding
 * agent requested an action, e.g. a diff scan.
 *
 * The value is declarative (any client can send any name) and comes from an
 * untrusted body, so it is only ever used as a display label, and it is
 * sanitised before it is stored: control and invisible format characters are
 * dropped, then the name is trimmed and capped.
 */
const MAX_CLIENT_NAME_LENGTH = 100;

// \p{Cc}: C0/C1 controls and DEL. \p{Cf}: invisible format characters such
// as bidi overrides and zero-width spaces, which could disguise a label.
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

export function sanitizeClientName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value
    .replace(INVISIBLE_CHARACTERS, '')
    .trim()
    .slice(0, MAX_CLIENT_NAME_LENGTH)
    .trim();
  return name || undefined;
}

/**
 * Read the client name from the body of the request that opens an MCP
 * session. The body is a single JSON-RPC message or, for older protocol
 * versions, a batch; only an `initialize` message carries `clientInfo`.
 */
export function extractClientName(body: unknown): string | undefined {
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const { method, params } = message as {
      method?: unknown;
      params?: { clientInfo?: { name?: unknown } };
    };
    if (method !== 'initialize') continue;
    return sanitizeClientName(params?.clientInfo?.name);
  }
  return undefined;
}
