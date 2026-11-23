// Generic: byte-identical in every gRPC service
// (scripts/tests/service-auth-parity.bats). Change all copies together.
//
// The literal values of scanner-call authentication: what a scanner pod
// sends, what a server writes once it has checked it, how a token is bound
// to one scan, the server's settings, its log lines and its refusals. They
// live in a file every gRPC service holds, so the generic server interceptor
// (./service-auth) and edition glue (./service-auth.edition) can use them; a
// service that answers scanners re-exports them from its own
// src/core/scanner-auth/scanner-auth.contract.ts.
//
// A scanner pod holds no service key. Where the deployment gives it one, it
// holds a token issued for its own pod, whose single audience names the
// project and the scan it runs; it sends that token on every call, and the
// server turns it into the identity headers below.
import { status } from '@grpc/grpc-js';

/** The token a scanner pod sends on every call. Its value is never logged. */
export const SCANNER_TOKEN_HEADER = 'x-cybedefend-scanner-token';

// The identity the server writes after it has verified the token.
export const SCANNER_POD_HEADER = 'x-cybedefend-scanner-pod';
export const SCANNER_POD_UID_HEADER = 'x-cybedefend-scanner-pod-uid';
export const SCANNER_NAMESPACE_HEADER = 'x-cybedefend-scanner-namespace';
export const SCANNER_SCAN_ID_HEADER = 'x-cybedefend-scanner-scan-id';
export const SCANNER_PROJECT_ID_HEADER = 'x-cybedefend-scanner-project-id';
/** The outcome of the token check: one of ScannerTokenState. */
export const SCANNER_AUTH_HEADER = 'x-cybedefend-scanner-auth';

export const SCANNER_IDENTITY_HEADERS = [
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_SCAN_ID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
] as const;

/**
 * Every header only the server may write. It deletes them from each incoming
 * call before anything else, whatever the caller, so a client cannot claim an
 * identity by sending them.
 */
export const SCANNER_SERVER_HEADERS = [
  ...SCANNER_IDENTITY_HEADERS,
  SCANNER_AUTH_HEADER,
] as const;

export type ScannerTokenState = 'ok' | 'missing' | 'invalid' | 'expired';

/** What a verified scanner token proves: the pod that holds it, and the scan it was issued for. */
export interface ScannerIdentity {
  readonly pod: string;
  readonly podUid: string;
  readonly namespace: string;
  readonly scanId: string;
  readonly projectId: string;
}

export type ScannerTokenCheck =
  | ScannerIdentity
  | { readonly reason: 'invalid' | 'expired' };

/**
 * Verifies scanner tokens, registered by the deployment's own code outside the
 * Community Edition (registerScannerCredentials). `token` is the header's
 * whole value.
 */
export interface ScannerCredentials {
  verify(token: string, nowSeconds: number): ScannerTokenCheck;
}

/** verify: refusals are logged and the call goes on; enforce: they are answered. */
export type ScannerAuthMode = 'verify' | 'enforce';

/** Why a scanner call is refused: its token, then its binding to the request. */
export type ScannerRefusalReason =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'not-bound'
  | 'closed'
  | 'lookup-failed';

const SCANNER_REFUSAL_REASONS: readonly ScannerRefusalReason[] = [
  'missing',
  'invalid',
  'expired',
  'not-bound',
  'closed',
  'lookup-failed',
];

// Audience: exactly one, `cybedefend:scanner:<projectId>:<scanId>`.
export const SCANNER_AUDIENCE_PREFIX = 'cybedefend:scanner';
export const SCANNER_AUDIENCE_PATTERN =
  /^cybedefend:scanner:([A-Za-z0-9-]{1,64}):([A-Za-z0-9-]{1,64})$/;

/** The audience of the token a scanner pod is given for one scan; throws on ids the verifier would refuse. */
export function scannerAudience(projectId: string, scanId: string): string {
  const audience = `${SCANNER_AUDIENCE_PREFIX}:${projectId}:${scanId}`;
  if (!SCANNER_AUDIENCE_PATTERN.test(audience)) {
    throw new Error('scanner audience: invalid project or scan id');
  }
  return audience;
}

/**
 * The project and scan a token's `aud` claim names: a string, or a list of
 * exactly one string. null for anything else, two audiences included.
 */
export function parseScannerAudience(
  aud: unknown,
): { projectId: string; scanId: string } | null {
  const single = Array.isArray(aud) && aud.length === 1 ? aud[0] : aud;
  if (typeof single !== 'string') return null;
  const match = SCANNER_AUDIENCE_PATTERN.exec(single);
  return match === null ? null : { projectId: match[1], scanId: match[2] };
}

// The server's settings, read from the environment.
export const SCANNER_AUTH_MODE_VARIABLE = 'SCANNER_AUTH_MODE';
export const SCANNER_AUTH_NAMESPACES_VARIABLE = 'SCANNER_AUTH_NAMESPACES';
export const SCANNER_AUTH_SERVICE_ACCOUNT_VARIABLE =
  'SCANNER_AUTH_SERVICE_ACCOUNT';
export const SCANNER_AUTH_CLOSED_GRACE_SECONDS_VARIABLE =
  'SCANNER_AUTH_CLOSED_GRACE_SECONDS';

/** The namespaces whose scanner pods a server accepts. */
export const DEFAULT_SCANNER_AUTH_NAMESPACES: readonly string[] = [
  'scanners-namespace',
  'scanners-container-namespace',
];
/** The service account a scanner token must be issued to. */
export const DEFAULT_SCANNER_AUTH_SERVICE_ACCOUNT = 'scanner-grpc';
/** How long a closed container's pod may still call, for its last retries. */
export const DEFAULT_SCANNER_AUTH_CLOSED_GRACE_SECONDS = 120;
const MAX_SCANNER_AUTH_CLOSED_GRACE_SECONDS = 3600;

type Environment = Readonly<Record<string, string | undefined>>;

export function readScannerAuthNamespaces(
  env: Environment = process.env,
): readonly string[] {
  const names = (env[SCANNER_AUTH_NAMESPACES_VARIABLE] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return names.length > 0 ? names : DEFAULT_SCANNER_AUTH_NAMESPACES;
}

/** The service account the verifier expects; unset or empty means the default. */
export function readScannerAuthServiceAccount(
  env: Environment = process.env,
): string {
  const raw = (env[SCANNER_AUTH_SERVICE_ACCOUNT_VARIABLE] ?? '').trim();
  return raw === '' ? DEFAULT_SCANNER_AUTH_SERVICE_ACCOUNT : raw;
}

/** A whole number of seconds from 0 to 3600; the default for anything else. */
export function readScannerAuthClosedGraceSeconds(
  env: Environment = process.env,
): number {
  const raw = (env[SCANNER_AUTH_CLOSED_GRACE_SECONDS_VARIABLE] ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_SCANNER_AUTH_CLOSED_GRACE_SECONDS;
  const seconds = Number(raw);
  return seconds <= MAX_SCANNER_AUTH_CLOSED_GRACE_SECONDS
    ? seconds
    : DEFAULT_SCANNER_AUTH_CLOSED_GRACE_SECONDS;
}

// The details of an enforced refusal. None reveals whether the scan exists.
export const SCANNER_AUTH_REQUIRED = 'SCANNER_AUTH_REQUIRED';
export const SCANNER_AUTH_NOT_BOUND = 'SCANNER_AUTH_NOT_BOUND';
export const SCANNER_AUTH_LOOKUP_FAILED = 'SCANNER_AUTH_LOOKUP_FAILED';

/** The gRPC answer to a refused scanner call in enforce. */
export function scannerRefusal(reason: ScannerRefusalReason): {
  code: status;
  details: string;
} {
  switch (reason) {
    case 'not-bound':
    case 'closed':
      return {
        code: status.PERMISSION_DENIED,
        details: SCANNER_AUTH_NOT_BOUND,
      };
    case 'lookup-failed':
      return { code: status.UNAVAILABLE, details: SCANNER_AUTH_LOOKUP_FAILED };
    default:
      return { code: status.UNAUTHENTICATED, details: SCANNER_AUTH_REQUIRED };
  }
}

// Log lines. Readers match the prefix; a new field goes at the end.
export const SCANNER_AUTH_REFUSED = 'SCANNER_AUTH_REFUSED';
export const SCANNER_AUTH_SUMMARY = 'SCANNER_AUTH_SUMMARY';

/** A field value on one line, without a space that would start another field. */
function field(value: string): string {
  return value.replace(/\s+/g, '_');
}

export function scannerAuthRefusedLine(entry: {
  method: string;
  reason: ScannerRefusalReason;
  mode: ScannerAuthMode;
  /** The pod the token names; unknown without a verified token. */
  pod?: string;
  /** The scan id of the request; none when it carries none. */
  scan?: string;
  peer: string;
  /** Where the refusal was decided, e.g. the interceptor or a handler's guard. */
  origin: string;
}): string {
  return [
    SCANNER_AUTH_REFUSED,
    `method=${field(entry.method)}`,
    `reason=${entry.reason}`,
    `mode=${entry.mode}`,
    `pod=${field(entry.pod || 'unknown')}`,
    `scan=${field(entry.scan || 'none')}`,
    `peer=${field(entry.peer)}`,
    `origin=${field(entry.origin)}`,
  ].join(' ');
}

/** One line per minute with the count of each outcome. */
export function scannerAuthSummaryLine(
  counts: Partial<Record<'ok' | ScannerRefusalReason, number>>,
): string {
  return [
    SCANNER_AUTH_SUMMARY,
    'window=60s',
    ...(['ok', ...SCANNER_REFUSAL_REASONS] as const).map(
      (key) => `${key}=${counts[key] ?? 0}`,
    ),
  ].join(' ');
}

/** Where the reporter writes; a Nest Logger or a test double. */
export interface ScannerAuthLogSink {
  warn(message: string): void;
}

const SCANNER_AUTH_LOG_INTERVAL_MS = 60_000;
const SCANNER_AUTH_LOG_MAX_KEYS = 10_000;

/**
 * Counts every scanner-call outcome and writes the refusal lines. The
 * interceptor (token checks) and the handlers' guard (binding checks) share
 * one per process, so the minute summary covers both. A refusal line is
 * written at most once a minute per method, reason and pod, so its absence
 * is meaningful but its count is not: the summary carries the counts.
 */
export class ScannerAuthReporter {
  private counts: Partial<Record<'ok' | ScannerRefusalReason, number>> = {};
  private readonly lastLogged = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly sink: ScannerAuthLogSink,
    private readonly now: () => number = Date.now,
  ) {}

  ok(): void {
    this.counts.ok = (this.counts.ok ?? 0) + 1;
  }

  refused(entry: Parameters<typeof scannerAuthRefusedLine>[0]): void {
    this.counts[entry.reason] = (this.counts[entry.reason] ?? 0) + 1;
    const key = `${entry.method}|${entry.reason}|${entry.pod || 'unknown'}`;
    const at = this.now();
    const previous = this.lastLogged.get(key);
    if (previous !== undefined && at - previous < SCANNER_AUTH_LOG_INTERVAL_MS)
      return;
    if (this.lastLogged.size >= SCANNER_AUTH_LOG_MAX_KEYS)
      this.lastLogged.clear();
    this.lastLogged.set(key, at);
    this.sink.warn(scannerAuthRefusedLine(entry));
  }

  /** Writes the summary when any counter is non-zero, then resets them. */
  flush(): void {
    const counts = this.counts;
    this.counts = {};
    if (Object.values(counts).some((n) => n > 0))
      this.sink.warn(scannerAuthSummaryLine(counts));
  }

  /** Flushes once a minute; the timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), SCANNER_AUTH_LOG_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

let sharedReporter: ScannerAuthReporter | undefined;

/** The process-wide reporter, created and started on first use. */
export function scannerAuthReporter(
  sink: ScannerAuthLogSink = console,
): ScannerAuthReporter {
  if (!sharedReporter) {
    sharedReporter = new ScannerAuthReporter(sink);
    sharedReporter.start();
  }
  return sharedReporter;
}
