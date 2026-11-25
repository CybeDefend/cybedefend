// Generic: byte-identical in every service that holds src/core/service-auth/
// (scripts/tests/service-auth-parity.bats). Change all copies together.
//
// Service-to-service authentication of the internal gRPC calls. Every client
// signs each call (HMAC-SHA256 over its own name, the method path and the
// time) in two metadata entries; every server checks them in a
// transport-level interceptor before any handler runs, with the key it holds
// for the caller the call claims to come from. Without it, any process that
// reaches a server's port could act as any user, since the acting user is a
// plain request field.
//
// Keys: the client picks its key per call, from the method path (the server
// is named by the proto package, see serviceAuthServerOf). A deployment that
// hands out one key per (caller, server) pair, as the Community Edition does,
// gives each server only the keys of the pairs it is the server of: a key
// read from one server signs calls to that server only, never as one of its
// callers to another server. A deployment may instead give a caller a single
// key for all its calls; every server it calls then holds that key.
//
// A deployment may register credentials (ServiceAuthCredentials) that prove
// each caller's identity instead: the client then sends their token and the
// server checks it with them, and no key is used on either side.
//
// Scanner pods hold no service key. On a scanner method, the server checks
// the token a scanner sends for its own pod (ScannerCredentials) and hands
// the handlers the identity it proves in headers only the server writes
// (./scanner-call-auth); the handlers then bind that identity to the request.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  InterceptingCall,
  Interceptor,
  Metadata,
  ServerInterceptingCall,
  ServerInterceptor,
  status,
} from '@grpc/grpc-js';
import {
  SCANNER_AUTH_HEADER,
  SCANNER_NAMESPACE_HEADER,
  SCANNER_POD_HEADER,
  SCANNER_POD_UID_HEADER,
  SCANNER_PROJECT_ID_HEADER,
  SCANNER_SCAN_ID_HEADER,
  SCANNER_SERVER_HEADERS,
  SCANNER_TOKEN_HEADER,
  ScannerAuthMode,
  ScannerAuthReporter,
  ScannerCredentials,
  ScannerTokenState,
  scannerAuthReporter,
  scannerRefusal,
} from './scanner-call-auth';

export const SERVICE_AUTH_CALLER_HEADER = 'x-cybedefend-service';
export const SERVICE_AUTH_TOKEN_HEADER = 'x-cybedefend-service-token';
/**
 * Where a refused call came from, as the proxies in front of the server saw it
 * (logged, never used to decide). The proxy next to the server writes the
 * address of the connection it received in SERVICE_AUTH_FORWARDED_HEADER, and
 * a shared proxy in front of it writes its own client's address in
 * SERVICE_AUTH_ORIGIN_HEADER; each overwrites any value the caller sent.
 */
export const SERVICE_AUTH_FORWARDED_HEADER = 'x-cybedefend-peer';
export const SERVICE_AUTH_ORIGIN_HEADER = 'x-cybedefend-origin';
/** Accepted distance between the token's time and the server's clock. */
export const SERVICE_AUTH_MAX_SKEW_SECONDS = 300;
/** Methods every caller may reach without a token: the probes. */
export const SERVICE_AUTH_EXEMPT_PREFIXES: readonly string[] = [
  '/grpc.health.v1.Health/',
];

const TOKEN_VERSION = 'v1';
const SIGNED_PREFIX = 'cybedefend-service-auth/v1';
const CALLER_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
const SECONDS = /^[0-9]{1,12}$/;
const LOG_INTERVAL_MS = 60_000;
const LOG_MAX_ENTRIES = 1_000;

export type ServiceAuthMode = 'verify' | 'enforce';

/** Who may call what. A method no entry names is closed to every caller. */
export interface ServiceAuthRules {
  /** gRPC service (`package.Service`) → the callers allowed on all its methods. */
  readonly services: Readonly<Record<string, readonly string[]>>;
  /** Method path (`/package.Service/Method`) → its callers; wins over `services`. */
  readonly methods: Readonly<Record<string, readonly string[]>>;
  /** More methods a scanner pod calls without a service token (see ServiceAuthPolicy). */
  readonly scannerMethods?: readonly string[];
}

export interface ServiceAuthPolicy extends ServiceAuthRules {
  /** The name this service signs its own calls with. */
  readonly caller: string;
  /** Methods a scanner pod calls without a service token, when the deployment allows it. */
  readonly scannerMethods: readonly string[];
}

/**
 * Credentials that prove each caller's identity without the HMAC keys,
 * registered by the deployment's own code outside the Community Edition
 * (which always signs with the HMAC keys). Both methods take the full method
 * path (`/package.Service/Method`); the credentials know which server serves
 * it.
 */
export interface ServiceAuthCredentials {
  /** The token this service sends on a call to `path`, or undefined when it holds none. */
  tokenFor(path: string): string | undefined;
  /** The caller a token received on `path` proves, or why it proves none. */
  verify(
    token: string,
    path: string,
    nowSeconds: number,
  ): ServiceAuthCredentialCheck;
}

export type ServiceAuthCredentialCheck =
  | { caller: string }
  | { reason: 'invalid' | 'expired' };

/** The keys that verify a caller: its current one first, then a previous one during a rotation. */
export type ServiceAuthCallerKeys = (caller: string) => readonly string[];

/** The key this service signs a call to the method `path` with, if it has one. */
export type ServiceAuthSigningKey = (path: string) => string | undefined;

function variableSuffix(name: string): string {
  if (!CALLER_NAME.test(name)) {
    throw new Error(`service-auth: invalid caller name "${name}"`);
  }
  return name.toUpperCase().replace(/-/g, '_');
}

/** The variable that holds the verification key of a caller, e.g. SERVICE_AUTH_PEER_KEY_SECURITY_SCANNING. */
export function serviceAuthPeerKeyName(caller: string): string {
  return `SERVICE_AUTH_PEER_KEY_${variableSuffix(caller)}`;
}

/** The variable that holds the key a caller signs its calls to a server with, e.g. SERVICE_AUTH_KEY_FOR_GLOBAL_MANAGEMENT. */
export function serviceAuthServerKeyName(server: string): string {
  return `SERVICE_AUTH_KEY_FOR_${variableSuffix(server)}`;
}

const SERVER_PACKAGE = /^\/cybedefend\.([a-z0-9_]+)\.[A-Za-z0-9_]+\/[^/]+$/;

/**
 * The service that serves a method path: its proto package is
 * `cybedefend.<server>` (underscores for dashes). Undefined for any other
 * path, which no per-server key signs.
 */
export function serviceAuthServerOf(path: string): string | undefined {
  const pkg = SERVER_PACKAGE.exec(path)?.[1];
  if (pkg === undefined) return undefined;
  const server = pkg.replace(/_/g, '-');
  return CALLER_NAME.test(server) ? server : undefined;
}

export function isServiceAuthCallerName(caller: string): boolean {
  return CALLER_NAME.test(caller);
}

/** The callers allowed on a method path; none when no rule names it. */
export function allowedServiceCallers(
  rules: ServiceAuthRules,
  path: string,
): readonly string[] {
  const byMethod = rules.methods[path];
  if (byMethod !== undefined) return byMethod;
  const service = /^\/([^/]+)\//.exec(path)?.[1];
  return (service !== undefined && rules.services[service]) || [];
}

/** Every caller a policy names: the ones a server needs a verification key for. */
export function serviceAuthCallersOf(rules: ServiceAuthRules): string[] {
  return [
    ...new Set(
      [
        ...Object.values(rules.services),
        ...Object.values(rules.methods),
      ].flat(),
    ),
  ].sort();
}

function mergeLists(
  base: Readonly<Record<string, readonly string[]>>,
  extra: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = { ...base };
  for (const [key, callers] of Object.entries(extra)) {
    out[key] = [...new Set([...(out[key] ?? []), ...callers])];
  }
  return out;
}

/** A policy with more rules: each entry's callers are the union of both. */
export function mergeServiceAuthRules(
  policy: ServiceAuthPolicy,
  extra: ServiceAuthRules,
): ServiceAuthPolicy {
  return {
    ...policy,
    services: mergeLists(policy.services, extra.services),
    methods: mergeLists(policy.methods, extra.methods),
    scannerMethods: [
      ...new Set([...policy.scannerMethods, ...(extra.scannerMethods ?? [])]),
    ],
  };
}

export interface ServiceAuthLogger {
  warn(message: string): void;
}

export type TokenCheck = 'ok' | 'missing' | 'invalid' | 'expired';

export type DecisionReason =
  | 'ok'
  | 'exempt'
  | 'scanner'
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'no-key'
  | 'legacy-key'
  | 'not-allowed';

export interface ServiceCallDecision {
  allow: boolean;
  reason: DecisionReason;
  /** The caller as it may be logged: its name, `unknown` or `invalid`. */
  caller: string;
  code?: status;
}

function sign(key: string, caller: string, path: string, seconds: string) {
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(`${SIGNED_PREFIX}\n${caller}\n${path}\n${seconds}`)
    .digest('base64url');
}

export function mintServiceToken(
  key: string,
  caller: string,
  path: string,
  nowSeconds: number,
): string {
  if (!CALLER_NAME.test(caller)) {
    throw new Error(`service-auth: invalid caller name "${caller}"`);
  }
  const seconds = String(Math.floor(nowSeconds));
  return `${TOKEN_VERSION}.${seconds}.${sign(key, caller, path, seconds)}`;
}

export function checkServiceToken(
  keys: readonly string[],
  caller: string,
  path: string,
  token: string | undefined,
  nowSeconds: number,
): TokenCheck {
  if (token === undefined || token === '') return 'missing';
  if (!CALLER_NAME.test(caller)) return 'invalid';
  const parts = token.split('.');
  if (parts.length !== 3) return 'invalid';
  const [version, seconds, signature] = parts;
  if (
    version !== TOKEN_VERSION ||
    !SECONDS.test(seconds) ||
    !SIGNATURE.test(signature)
  ) {
    return 'invalid';
  }
  const given = Buffer.from(signature, 'base64url');
  let matched = false;
  for (const key of keys) {
    const expected = Buffer.from(sign(key, caller, path, seconds), 'base64url');
    // Every key is compared, in constant time, whatever the first answer.
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      matched = true;
    }
  }
  if (!matched) return 'invalid';
  if (Math.abs(nowSeconds - Number(seconds)) > SERVICE_AUTH_MAX_SKEW_SECONDS) {
    return 'expired';
  }
  return 'ok';
}

function loggableCaller(caller: string | undefined): string {
  if (caller === undefined || caller === '') return 'unknown';
  return CALLER_NAME.test(caller) ? caller : 'invalid';
}

export interface ServiceCallInput {
  path: string;
  caller: string | undefined;
  token: string | undefined;
  /** The keys of the caller the call claims to come from. */
  keys: readonly string[];
  /**
   * The former key shared by every service, recognised during a migration
   * only: a call signed with it is reported (legacy-key), never trusted.
   */
  legacyKeys?: readonly string[];
  nowSeconds: number;
  policy: ServiceAuthPolicy;
  allowScannerCalls: boolean;
  /**
   * The registered credentials' check. When set, it alone proves the caller:
   * the keys, current and former, are not consulted.
   */
  verify?: ServiceAuthCredentials['verify'];
}

export function decideServiceCall(
  input: ServiceCallInput,
): ServiceCallDecision {
  const caller = loggableCaller(input.caller);
  const deny = (reason: DecisionReason, code: status): ServiceCallDecision => ({
    allow: false,
    reason,
    caller,
    code,
  });
  if (SERVICE_AUTH_EXEMPT_PREFIXES.some((p) => input.path.startsWith(p))) {
    return { allow: true, reason: 'exempt', caller };
  }
  const token = input.token ?? '';
  const hasToken = token !== '';
  if (
    !hasToken &&
    input.allowScannerCalls &&
    input.policy.scannerMethods.includes(input.path)
  ) {
    return { allow: true, reason: 'scanner', caller: 'scanner' };
  }
  const claimed = input.caller ?? '';
  if (!hasToken) return deny('missing', status.UNAUTHENTICATED);
  if (input.verify !== undefined) {
    return decideByCredentials(input, token, input.verify, deny);
  }
  if (!CALLER_NAME.test(claimed))
    return deny('invalid', status.UNAUTHENTICATED);
  const legacyKeys = input.legacyKeys ?? [];
  if (input.keys.length === 0 && legacyKeys.length === 0) {
    return deny('no-key', status.UNAUTHENTICATED);
  }
  const check =
    input.keys.length > 0
      ? checkServiceToken(
          input.keys,
          claimed,
          input.path,
          input.token,
          input.nowSeconds,
        )
      : 'invalid';
  const legacy =
    check === 'invalid' &&
    legacyKeys.length > 0 &&
    checkServiceToken(
      legacyKeys,
      claimed,
      input.path,
      input.token,
      input.nowSeconds,
    ) === 'ok';
  if (check !== 'ok' && !legacy) {
    return deny(
      input.keys.length > 0 ? check : 'no-key',
      status.UNAUTHENTICATED,
    );
  }
  if (!allowedServiceCallers(input.policy, input.path).includes(caller)) {
    return deny('not-allowed', status.PERMISSION_DENIED);
  }
  if (legacy) return deny('legacy-key', status.UNAUTHENTICATED);
  return { allow: true, reason: 'ok', caller };
}

/**
 * The credentials prove the caller; a call that names another one is
 * refused, since a caller name the token does not back proves nothing.
 */
function decideByCredentials(
  input: ServiceCallInput,
  token: string,
  verify: ServiceAuthCredentials['verify'],
  deny: (reason: DecisionReason, code: status) => ServiceCallDecision,
): ServiceCallDecision {
  const check = verify(token, input.path, input.nowSeconds);
  if ('reason' in check) return deny(check.reason, status.UNAUTHENTICATED);
  const proven = check.caller;
  if (!CALLER_NAME.test(proven)) return deny('invalid', status.UNAUTHENTICATED);
  const named = input.caller;
  if (named !== undefined && named !== '' && named !== proven) {
    return deny('invalid', status.UNAUTHENTICATED);
  }
  if (!allowedServiceCallers(input.policy, input.path).includes(proven)) {
    return {
      allow: false,
      reason: 'not-allowed',
      caller: proven,
      code: status.PERMISSION_DENIED,
    };
  }
  return { allow: true, reason: 'ok', caller: proven };
}

/** At most one line a minute per key; the map is bounded (callers are untrusted). */
class ThrottledLog {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly logger: ServiceAuthLogger,
    private readonly now: () => number,
  ) {}

  warn(key: string, message: string): void {
    const at = this.now();
    const previous = this.last.get(key);
    if (previous !== undefined && at - previous < LOG_INTERVAL_MS) return;
    if (this.last.size >= LOG_MAX_ENTRIES) this.last.clear();
    this.last.set(key, at);
    this.logger.warn(message);
  }
}

function firstValue(metadata: Metadata, name: string): string | undefined {
  const value = metadata.get(name)[0];
  return typeof value === 'string' ? value : undefined;
}

/** An address as a log field: its own characters only, so it cannot add fields. */
const ADDRESS_FIELD = /^[0-9A-Za-z.:[\]%,_-]{1,100}$/;

function addressField(value: string): string {
  return ADDRESS_FIELD.test(value) ? value : 'invalid';
}

/**
 * The address fields of a refusal line. `peer` is the connection the server
 * accepted: the real caller when nothing stands in front of the server, the
 * local proxy otherwise. `forwarded` and `origin` are headers, so they are
 * trustworthy only when a proxy that overwrites them carries every call: a
 * caller that reaches the server directly sets them freely, and its `peer`
 * then is not the proxy's. `origin` is written by the shared proxy, so a
 * caller that goes around it can forge `origin`, and `forwarded` (written by
 * the proxy next to the server) then names that caller instead of the shared
 * proxy.
 */
function originFields(peer: string, metadata: Metadata): string {
  let fields = ` peer=${addressField(peer)}`;
  for (const [name, header] of [
    ['forwarded', SERVICE_AUTH_FORWARDED_HEADER],
    ['origin', SERVICE_AUTH_ORIGIN_HEADER],
  ]) {
    const values = metadata.get(header);
    if (values.length === 0) continue;
    const joined = values.every((v) => typeof v === 'string')
      ? values.join(',')
      : '';
    fields += ` ${name}=${addressField(joined)}`;
  }
  return fields;
}

export interface ServerInterceptorOptions {
  policy: () => ServiceAuthPolicy;
  /** The verification keys of a claimed caller (a valid caller name). */
  keys: ServiceAuthCallerKeys;
  /** The former shared key(s), during a migration; none by default. */
  legacyKeys?: () => readonly string[];
  mode: () => ServiceAuthMode;
  allowScannerCalls: () => boolean;
  logger: ServiceAuthLogger;
  /** Milliseconds; Date.now by default. */
  now?: () => number;
  /** The registered credentials, read on every call; the keys decide when none. */
  credentials?: () => ServiceAuthCredentials | null;
  /** The scanner token verifier, read on every scanner call; none means every token is invalid. */
  scannerCredentials?: () => ScannerCredentials | null;
  /** What a scanner call with no valid token gets; verify (served, marked) by default. */
  scannerMode?: () => ScannerAuthMode;
  /**
   * Where scanner refusals are counted and logged. By default the
   * process-wide reporter, created on the first scanner call with this
   * interceptor's logger (the first one to create it keeps its logger).
   */
  scannerReporter?: Pick<ScannerAuthReporter, 'refused'>;
}

/** The outcome of a scanner token: the identity it proves, or why it proves none. */
function checkScannerToken(
  token: string | undefined,
  credentials: ScannerCredentials | null,
  nowSeconds: number,
):
  | { state: 'ok'; headers: [string, string][] }
  | { state: Exclude<ScannerTokenState, 'ok'> } {
  if (token === undefined || token === '') return { state: 'missing' };
  if (credentials === null) return { state: 'invalid' };
  let check: ReturnType<ScannerCredentials['verify']>;
  try {
    check = credentials.verify(token, nowSeconds);
  } catch {
    return { state: 'invalid' };
  }
  if ('reason' in check) return { state: check.reason };
  return {
    state: 'ok',
    headers: [
      [SCANNER_POD_HEADER, check.pod],
      [SCANNER_POD_UID_HEADER, check.podUid],
      [SCANNER_NAMESPACE_HEADER, check.namespace],
      [SCANNER_SCAN_ID_HEADER, check.scanId],
      [SCANNER_PROJECT_ID_HEADER, check.projectId],
    ],
  };
}

export function createServiceAuthServerInterceptor(
  options: ServerInterceptorOptions,
): ServerInterceptor {
  const now = options.now ?? Date.now;
  const log = new ThrottledLog(options.logger, now);
  const reporter = () =>
    options.scannerReporter ?? scannerAuthReporter(options.logger);
  return (methodDescriptor, call) =>
    new ServerInterceptingCall(call, {
      start: (next) => {
        next({
          onReceiveMetadata: (metadata, mdNext) => {
            const path = methodDescriptor.path;
            // Only this server writes the scanner headers, whatever the
            // call: a client's own values never reach a handler. The token
            // is read once and never forwarded either.
            const scannerToken = firstValue(metadata, SCANNER_TOKEN_HEADER);
            metadata.remove(SCANNER_TOKEN_HEADER);
            for (const header of SCANNER_SERVER_HEADERS) {
              metadata.remove(header);
            }
            const caller = firstValue(metadata, SERVICE_AUTH_CALLER_HEADER);
            const credentials = options.credentials?.() ?? null;
            // With credentials the keys are never read: they prove nothing.
            const decision = decideServiceCall({
              path,
              caller,
              token: firstValue(metadata, SERVICE_AUTH_TOKEN_HEADER),
              keys:
                credentials === null &&
                caller !== undefined &&
                CALLER_NAME.test(caller)
                  ? options.keys(caller)
                  : [],
              legacyKeys:
                credentials === null ? (options.legacyKeys?.() ?? []) : [],
              nowSeconds: Math.floor(now() / 1000),
              policy: options.policy(),
              allowScannerCalls: options.allowScannerCalls(),
              verify:
                credentials === null
                  ? undefined
                  : (token, p, nowSeconds) =>
                      credentials.verify(token, p, nowSeconds),
            });
            // The handlers never see the token.
            metadata.remove(SERVICE_AUTH_TOKEN_HEADER);
            if (decision.allow && decision.reason === 'scanner') {
              const nowSeconds = Math.floor(now() / 1000);
              const scanner = checkScannerToken(
                scannerToken,
                options.scannerCredentials?.() ?? null,
                nowSeconds,
              );
              if (scanner.state === 'ok') {
                for (const [name, value] of scanner.headers) {
                  metadata.set(name, value);
                }
                metadata.set(SCANNER_AUTH_HEADER, 'ok');
                mdNext(metadata);
                return;
              }
              const scannerMode = options.scannerMode?.() ?? 'verify';
              reporter().refused({
                method: path,
                reason: scanner.state,
                mode: scannerMode,
                peer: addressField(call.getPeer()),
                origin: 'interceptor',
              });
              if (scannerMode === 'enforce') {
                call.sendStatus({
                  ...scannerRefusal(scanner.state),
                  metadata: new Metadata(),
                });
                return;
              }
              metadata.set(SCANNER_AUTH_HEADER, scanner.state);
              mdNext(metadata);
              return;
            }
            if (decision.allow) {
              mdNext(metadata);
              return;
            }
            const mode = options.mode();
            // A server without the key of a caller refuses all its calls: one
            // line a minute per caller says so, not one per method.
            log.warn(
              decision.reason === 'no-key'
                ? `${decision.caller}|no-key`
                : `${decision.caller}|${path}|${decision.reason}`,
              // New fields go at the end: readers match the line's start.
              `S2S_AUTH_MISSING caller=${decision.caller} method=${path} reason=${decision.reason} mode=${mode}` +
                originFields(call.getPeer(), metadata),
            );
            if (mode === 'enforce') {
              call.sendStatus({
                code: decision.code ?? status.UNAUTHENTICATED,
                details:
                  decision.code === status.PERMISSION_DENIED
                    ? 'SERVICE_AUTH_NOT_ALLOWED'
                    : 'SERVICE_AUTH_REQUIRED',
                metadata: new Metadata(),
              });
              return;
            }
            mdNext(metadata);
          },
        });
      },
    });
}

export interface ClientInterceptorOptions {
  caller: string;
  key: ServiceAuthSigningKey;
  logger: ServiceAuthLogger;
  /** Milliseconds; Date.now by default. */
  now?: () => number;
  /** The registered credentials, read on every call; the key signs when none. */
  credentials?: () => ServiceAuthCredentials | null;
}

export function createServiceAuthClientInterceptor(
  options: ClientInterceptorOptions,
): Interceptor {
  const now = options.now ?? Date.now;
  if (!CALLER_NAME.test(options.caller)) {
    throw new Error(`service-auth: invalid caller name "${options.caller}"`);
  }
  let warned = false;
  return (callOptions, nextCall) =>
    new InterceptingCall(nextCall(callOptions), {
      start: (metadata, listener, next) => {
        const path = callOptions.method_definition.path;
        const credentials = options.credentials?.() ?? null;
        if (credentials !== null) {
          // The registered credentials replace the key: no HMAC token at all.
          const token = credentials.tokenFor(path);
          if (token) {
            metadata.set(SERVICE_AUTH_CALLER_HEADER, options.caller);
            metadata.set(SERVICE_AUTH_TOKEN_HEADER, token);
          } else if (!warned) {
            warned = true;
            options.logger.warn(
              `S2S_AUTH_KEY_MISSING caller=${options.caller}`,
            );
          }
          next(metadata, listener);
          return;
        }
        const key = options.key(path);
        if (key) {
          metadata.set(SERVICE_AUTH_CALLER_HEADER, options.caller);
          metadata.set(
            SERVICE_AUTH_TOKEN_HEADER,
            mintServiceToken(
              key,
              options.caller,
              path,
              Math.floor(now() / 1000),
            ),
          );
        } else if (!warned) {
          warned = true;
          options.logger.warn(`S2S_AUTH_KEY_MISSING caller=${options.caller}`);
        }
        next(metadata, listener);
      },
    });
}
