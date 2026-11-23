// Generic: byte-identical in every service with an edition layer
// (scripts/tests/service-auth-parity.bats). Change all copies together.
//
// Where the mode and the keys of service-to-service authentication come
// from, and the channel options every gRPC server and client of this service
// is built with. The service's own rules are in ./service-auth.policy.
//
// Keys: SERVICE_AUTH_KEY signs this service's own calls. Each caller it
// serves is verified with SERVICE_AUTH_PEER_KEY_<CALLER> (then
// <that name>_PREVIOUS during a rotation), read like any secret, else from
// the file of that name in SERVICE_AUTH_PEER_KEYS_DIR. A server is handed
// only the keys of the callers its policy names. SERVICE_AUTH_LEGACY_KEY, the
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

/** The HKDF info of a caller's key in the Community Edition. */
export function serviceAuthCommunityInfo(caller: string): string {
  return `${SERVICE_AUTH_COMMUNITY_INFO}/${caller}`;
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

function communityKey(caller: string): string | undefined {
  let raw = process.env[MASTER_KEY_VARIABLE];
  if (raw === undefined || raw === '') {
    const file = process.env[`${MASTER_KEY_VARIABLE}_FILE`];
    if (file === undefined || file === '') return undefined;
    raw = readFileSync(file, 'utf8').replace(/\s+$/, '');
  }
  const cached = derived.get(caller);
  if (cached !== undefined && cached.raw === raw) return cached.key;
  const key = deriveKey(
    decodeMasterKey(raw),
    serviceAuthCommunityInfo(caller),
  ).toString('hex');
  derived.set(caller, { raw, key });
  return key;
}

const usable = (keys: (string | undefined)[]): string[] =>
  keys.filter(
    (k): k is string => k !== undefined && k.length >= MIN_KEY_LENGTH,
  );

/** The key this service signs its calls with; undefined when none is configured. */
export function resolveServiceAuthSigningKey(): string | undefined {
  return usable([
    lookup(SERVICE_AUTH_KEY_NAME) ??
      (isCommunity() ? communityKey(SERVICE_AUTH_POLICY.caller) : undefined),
  ])[0];
}

/** The keys that verify a caller, its current one first; empty when this service holds none. */
export function resolveServiceAuthCallerKeys(caller: string): string[] {
  if (!isServiceAuthCallerName(caller)) return [];
  if (caller === SERVICE_AUTH_POLICY.caller) {
    return usable([resolveServiceAuthSigningKey()]);
  }
  const name = serviceAuthPeerKeyName(caller);
  return usable([
    lookupPeer(name) ?? (isCommunity() ? communityKey(caller) : undefined),
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
