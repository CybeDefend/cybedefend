import { parseTrustProxyCidrs } from '../trust-proxy/trust-proxy';

/**
 * HTTP surface options shared verbatim between `main.ts` and the e2e
 * harnesses (`oauth-client-matrix.e2e-spec.ts`), so the routing and CORS
 * assertions exercise the production wiring rather than a lookalike.
 */

/**
 * Fastify adapter options.
 *
 * `ignoreTrailingSlash` + `ignoreDuplicateSlashes`: OAuth discovery clients
 * derive well-known URLs from a base they may have normalised with a
 * trailing slash (Devin's Rust client logs its expected issuer as
 * `https://host/`, slash included) or joined sloppily (`//.well-known/…`).
 * A 404 on those variants does not stop such clients — it sends them down
 * degraded fallbacks ("legacy OAuth endpoints derived from the base URL",
 * metadata without an issuer) that fail later, at the token exchange, where
 * the cause is no longer legible. No route on this service distinguishes
 * itself by a trailing or doubled slash, so tolerance is free.
 */
export function httpAdapterOptions(trustProxyCidr?: string) {
  return {
    // Never an unconditional `trustProxy: true`: the pre-auth rate-limiter
    // keys its buckets on the client IP, so X-Forwarded-For is honoured only
    // from the configured upstream hops (the CIDR list, or `false` when unset).
    trustProxy: parseTrustProxyCidrs(trustProxyCidr),
    // Clamp to 256 KB. MCP messages are RPC envelopes: they never
    // legitimately carry file-sized payloads, and a small cap bounds the
    // memory one request to the public /mcp entry can take. Tools that need large content fetch it via their own gateway
    // hop; the wire format here stays small.
    bodyLimit: 256 * 1024,
    ignoreTrailingSlash: true,
    ignoreDuplicateSlashes: true,
  };
}

/**
 * CORS for the public MCP/OAuth surface.
 *
 * Browser-based MCP clients (claude.ai / ChatGPT connectors, VS Code Web)
 * run the whole handshake from a browser context: without a reflected
 * `Access-Control-Allow-Origin` they cannot even read the discovery
 * documents, let alone POST /mcp. Every route on this service authenticates
 * with a Bearer token — no cookies, no ambient credentials — so reflecting
 * any origin **without** credentials adds no risk: a cross-site page gains
 * nothing it could not already do with a server-side request.
 *
 * `allowedHeaders` must cover everything an MCP browser client preflights:
 * the Streamable HTTP transport sends `MCP-Protocol-Version` on every
 * request and `Last-Event-ID` when resuming an SSE stream.
 */
export const corsOptions = {
  origin: true,
  credentials: false,
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'mcp-session-id',
    'mcp-protocol-version',
    'last-event-id',
  ],
  exposedHeaders: ['mcp-session-id', 'WWW-Authenticate'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
};
