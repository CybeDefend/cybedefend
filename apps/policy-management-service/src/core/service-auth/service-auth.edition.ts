// Generic: byte-identical in every service with an edition layer
// (scripts/tests/service-auth-parity.bats). Change all copies together.
//
// Where the mode and the keys of service-to-service authentication come
// from, and the channel options every gRPC server and client of this service
// is built with. The service's own rules are in ./service-auth.policy.
//
// Keys: a call to a server signs with SERVICE_AUTH_KEY_FOR_<SERVER>, the key
// of the pair (this service, that server), else with SERVICE_AUTH_KEY, a
// single key for all of this service's calls (in the Community Edition, the
// earlier layout: reported once per process). Each caller it serves is
// verified with SERVICE_AUTH_PEER_KEY_<CALLER> (then <that name>_PREVIOUS
// during a rotation). Each is read like any secret, else from the file of
// that name in SERVICE_AUTH_PEER_KEYS_DIR (SERVICE_AUTH_KEY from
// SERVICE_AUTH_KEY_FILE). With one key per pair, a server holds the keys of
// the pairs it serves only, so it cannot sign as one of its callers to
// another server. A server is handed only the keys of the callers its policy
// names. In the Community Edition, a service that holds the master key
// derives the key of each pair from it instead. SERVICE_AUTH_LEGACY_KEY, the
// former key shared by every service, is only recognised (and reported)
// while a deployment moves to per-caller keys. Outside the Community Edition,
// registered credentials replace all of these keys on every call.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { Interceptor, ServerInterceptor } from '@grpc/grpc-js';
import { currentEdition } from '../../edition/edition';
import {
  MASTER_KEY_VARIABLE,
  decodeMasterKey,
  deriveKey,
} from '../secrets/secret-key';
import {
  ServiceAuthCredentials,
  ServiceAuthLogger,
  ServiceAuthMode,
  ServiceAuthPolicy,
  ServiceAuthRules,
  createServiceAuthClientInterceptor,
  createServiceAuthServerInterceptor,
  isServiceAuthCallerName,
  mergeServiceAuthRules,
  serviceAuthPeerKeyName,
  serviceAuthServerKeyName,
  serviceAuthServerOf,
} from './service-auth';
import { SERVICE_AUTH_POLICY } from './service-auth.policy';
import {
  SCANNER_AUTH_MODE_VARIABLE,
  ScannerAuthMode,
  ScannerCredentials,
} from './scanner-call-auth';

export const SERVICE_AUTH_KEY_NAME = 'SERVICE_AUTH_KEY';
export const SERVICE_AUTH_LEGACY_KEY_NAME = 'SERVICE_AUTH_LEGACY_KEY';
export const SERVICE_AUTH_PEER_KEYS_DIR = 'SERVICE_AUTH_PEER_KEYS_DIR';
/** HKDF info prefix of the Community Edition's keys, derived from CYBEDEFEND_SECRET_KEY. */
export const SERVICE_AUTH_COMMUNITY_INFO = 'service-to-service-auth';
const MIN_KEY_LENGTH = 32;

type SecretLookup = (name: string) => string | undefined;

let registeredSource: SecretLookup | null = null;
let registeredRules: ServiceAuthRules | null = null;
let registeredCredentials: ServiceAuthCredentials | null = null;
let registeredScannerCredentials: ScannerCredentials | null = null;
const derived = new Map<string, { raw: string; key: string }>();

/** The HKDF info of the key of a (caller, server) pair in the Community Edition. */
export function serviceAuthCommunityPairInfo(
  caller: string,
  server: string,
): string {
  return `${SERVICE_AUTH_COMMUNITY_INFO}/${caller}/${server}`;
}

/**
 * The service's SecretsService registers itself here when it is built, so
 * every process (API, workers, crons) reads the keys with the same precedence
 * as its other secrets. null clears it (tests).
 */
export function registerServiceAuthKeySource(lookup: SecretLookup | null) {
  registeredSource = lookup;
}

/**
 * More rules for this service's servers, outside the Community Edition: the
 * callers and methods that exist only in other builds register here when
 * their code loads. null clears them (tests).
 */
export function registerServiceAuthRules(rules: ServiceAuthRules | null) {
  registeredRules = rules;
}

/**
 * Credentials that replace the HMAC keys outside the Community Edition (the
 * deployment's pod identity). null clears them (tests).
 */
export function registerServiceAuthCredentials(
  credentials: ServiceAuthCredentials | null,
) {
  registeredCredentials = credentials;
}

/** The registered credentials outside the Community Edition; null there, or when none is registered. */
export function serviceAuthCredentials(): ServiceAuthCredentials | null {
  return isCommunity() ? null : registeredCredentials;
}

function isCommunity(): boolean {
  return currentEdition() === 'community';
}

/** The rules this service's servers apply: its own, plus the registered ones outside the Community Edition. */
export function serviceAuthPolicy(): ServiceAuthPolicy {
  if (isCommunity() || registeredRules === null) return SERVICE_AUTH_POLICY;
  return mergeServiceAuthRules(SERVICE_AUTH_POLICY, registeredRules);
}

/**
 * The Community Edition always enforces: it ships the check and every caller
 * at once. Elsewhere SERVICE_AUTH_MODE decides, verify by default, so that a
 * deployment turns enforcement on once every caller signs its calls.
 */
export function resolveServiceAuthMode(): ServiceAuthMode {
  if (isCommunity()) return 'enforce';
  const raw = process.env.SERVICE_AUTH_MODE;
  if (raw === undefined || raw === '') return 'verify';
  if (raw === 'verify' || raw === 'enforce') return raw;
  throw new Error('SERVICE_AUTH_MODE must be verify or enforce');
}

/**
 * The verifier of scanner tokens outside the Community Edition (the
 * deployment's pod identity). null clears it (tests).
 */
export function registerScannerCredentials(
  credentials: ScannerCredentials | null,
) {
  registeredScannerCredentials = credentials;
}

/** The registered scanner token verifier; null in the Community Edition, or when none is registered. */
export function scannerCredentials(): ScannerCredentials | null {
  return isCommunity() ? null : registeredScannerCredentials;
}

/**
 * The Community Edition enforces: it accepts no scanner call (it lets none in
 * unsigned and verifies no scanner token). Elsewhere a deployment turns
 * enforcement on with SCANNER_AUTH_MODE=enforce once every scanner sends its
 * token; any other value only verifies, so a typo never refuses scans.
 */
export function resolveScannerAuthMode(): ScannerAuthMode {
  if (isCommunity()) return 'enforce';
  return process.env[SCANNER_AUTH_MODE_VARIABLE] === 'enforce'
    ? 'enforce'
    : 'verify';
}

/** Scanner pods hold no service key; only a deployment that routes them may let them in. */
export function serviceAuthAllowsScannerCalls(): boolean {
  return (
    !isCommunity() && process.env.SERVICE_AUTH_ALLOW_SCANNER_CALLS === 'true'
  );
}

function readKeyFile(file: string): string | undefined {
  const value = readFileSync(file, 'utf8').replace(/\s+$/, '');
  return value === '' ? undefined : value;
}

function lookup(name: string): string | undefined {
  const fromSource = registeredSource?.(name);
  if (fromSource !== undefined && fromSource !== '') return fromSource;
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  // Read here too, so a process whose secrets source is not built yet (or
  // never is) still finds the key the deployment hands it as a file.
  const file = process.env[`${name}_FILE`];
  if (file === undefined || file === '') return undefined;
  return readKeyFile(file);
}

/** A caller's key, from the variable of that name or the file of that name in SERVICE_AUTH_PEER_KEYS_DIR. */
function lookupPeer(name: string): string | undefined {
  const value = lookup(name);
  if (value !== undefined) return value;
  const dir = process.env[SERVICE_AUTH_PEER_KEYS_DIR];
  if (dir === undefined || dir === '') return undefined;
  const file = join(dir, name);
  return existsSync(file) ? readKeyFile(file) : undefined;
}

let singleKeyReported = false;

/** Lets the next use of the single key be reported again (tests). */
export function resetServiceAuthSingleKeyWarning(): void {
  singleKeyReported = false;
}

/**
 * The Community Edition hands out one key per (caller, server) pair. A single
 * SERVICE_AUTH_KEY there means the deploy files predate the images: every
 * server this service calls then holds the key that signs all its calls. Said
 * once per process, with no key material.
 */
function reportSingleKeyLayout(): void {
  if (!isCommunity() || singleKeyReported) return;
  singleKeyReported = true;
  logger().warn(
    `S2S_AUTH_SINGLE_KEY caller=${SERVICE_AUTH_POLICY.caller}: the internal gRPC keys are the earlier single-key layout, one key for all of this service's calls, held by every server it calls. Take docker-compose.yml and its runtime/ folder from the same release as the images.`,
  );
}

/** The key of a (caller, server) pair, derived from the master key when this process holds it. */
function communityKey(caller: string, server: string): string | undefined {
  let raw = process.env[MASTER_KEY_VARIABLE];
  if (raw === undefined || raw === '') {
    const file = process.env[`${MASTER_KEY_VARIABLE}_FILE`];
    if (file === undefined || file === '') return undefined;
    raw = readFileSync(file, 'utf8').replace(/\s+$/, '');
  }
  const info = serviceAuthCommunityPairInfo(caller, server);
  const cached = derived.get(info);
  if (cached !== undefined && cached.raw === raw) return cached.key;
  const key = deriveKey(decodeMasterKey(raw), info).toString('hex');
  derived.set(info, { raw, key });
  return key;
}

const usable = (keys: (string | undefined)[]): string[] =>
  keys.filter(
    (k): k is string => k !== undefined && k.length >= MIN_KEY_LENGTH,
  );

/** The key this service signs its calls to `server` with (undefined: a server of no known name). */
function signingKeyFor(server: string | undefined): string | undefined {
  const own = SERVICE_AUTH_POLICY.caller;
  const pairKey =
    server === undefined
      ? undefined
      : lookupPeer(serviceAuthServerKeyName(server));
  if (pairKey !== undefined) return usable([pairKey])[0];
  const configured = lookup(SERVICE_AUTH_KEY_NAME);
  if (configured !== undefined) {
    const singleKey = usable([configured])[0];
    if (singleKey !== undefined) reportSingleKeyLayout();
    return singleKey;
  }
  return usable([
    isCommunity() && server !== undefined
      ? communityKey(own, server)
      : undefined,
  ])[0];
}

/**
 * The key this service signs a call to the method `path` with: the key of the
 * pair (this service, the server of that method), else its single key;
 * undefined when none is configured.
 */
export function resolveServiceAuthSigningKey(
  path?: string,
): string | undefined {
  return signingKeyFor(
    path === undefined ? undefined : serviceAuthServerOf(path),
  );
}

/** The keys that verify a caller, its current one first; empty when this service holds none. */
export function resolveServiceAuthCallerKeys(caller: string): string[] {
  if (!isServiceAuthCallerName(caller)) return [];
  const own = SERVICE_AUTH_POLICY.caller;
  if (caller === own) return usable([signingKeyFor(own)]);
  const name = serviceAuthPeerKeyName(caller);
  return usable([
    lookupPeer(name) ?? (isCommunity() ? communityKey(caller, own) : undefined),
    lookupPeer(`${name}_PREVIOUS`),
  ]);
}

/** The former shared key, recognised during a migration; never in the Community Edition. */
export function resolveServiceAuthLegacyKeys(): string[] {
  return isCommunity() ? [] : usable([lookup(SERVICE_AUTH_LEGACY_KEY_NAME)]);
}

function logger(): ServiceAuthLogger {
  const nest = new Logger('ServiceAuth');
  return { warn: (message) => nest.warn(message) };
}

/** `channelOptions` of this service's gRPC server: checks every call. */
export function serviceAuthServerChannelOptions(): {
  interceptors: ServerInterceptor[];
} {
  const mode = resolveServiceAuthMode();
  const allowScannerCalls = serviceAuthAllowsScannerCalls();
  const scannerMode = resolveScannerAuthMode();
  return {
    interceptors: [
      createServiceAuthServerInterceptor({
        policy: serviceAuthPolicy,
        keys: resolveServiceAuthCallerKeys,
        legacyKeys: resolveServiceAuthLegacyKeys,
        mode: () => mode,
        allowScannerCalls: () => allowScannerCalls,
        logger: logger(),
        credentials: serviceAuthCredentials,
        scannerCredentials,
        scannerMode: () => scannerMode,
      }),
    ],
  };
}

/** To spread into the `channelOptions` of every gRPC client: signs every call. */
export function serviceAuthClientChannelOptions(): {
  interceptors: Interceptor[];
} {
  // Said at start, not at the first call: a single key handed to this
  // service is the earlier layout (see reportSingleKeyLayout).
  if (isCommunity()) {
    try {
      if (usable([lookup(SERVICE_AUTH_KEY_NAME)]).length > 0) {
        reportSingleKeyLayout();
      }
    } catch {
      // An unreadable key file is reported by the call that needs it.
    }
  }
  return {
    interceptors: [
      createServiceAuthClientInterceptor({
        caller: SERVICE_AUTH_POLICY.caller,
        key: resolveServiceAuthSigningKey,
        logger: logger(),
        credentials: serviceAuthCredentials,
      }),
    ],
  };
}
