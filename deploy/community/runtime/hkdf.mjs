// CybeDefend Community Edition: the master key and its HKDF derivation.
//
// Mirrors src/core/secrets/secret-key.ts of the services: same decoding rules,
// same messages, same salt and info strings, so a value derived here equals the
// value a service derives (pinned by libs/test-fixtures/secrets/hkdf-vectors.json).

import { hkdfSync } from 'node:crypto';

export const MASTER_KEY_VARIABLE = 'CYBEDEFEND_SECRET_KEY';
export const COMMUNITY_HKDF_SALT = 'cybedefend-community';
export const MIN_MASTER_KEY_BYTES = 32;

/**
 * The five keys the services derive, each in the encoding its consumer
 * decodes, plus AUTH_RESET_REQUESTER_HMAC_KEY (hex), the key of the HMAC that
 * stores a password-reset requester's address.
 */
export const DERIVED_SECRET_KEYS = Object.freeze({
  CONTAINER_REGISTRY_ENCRYPTION_KEY: { info: 'container-registry-encryption', encoding: 'hex' },
  GITLAB_ENCRYPTION_KEY: { info: 'gitlab-encryption', encoding: 'hex' },
  SECRET_ENCRYPTION_KEY: { info: 'secret-finding-encryption', encoding: 'base64' },
  SCAN_METADATA_ENCRYPTION_KEY: { info: 'scan-metadata-encryption', encoding: 'hex' },
  AUTH_SIGNING_KEY_ENCRYPTION_KEY: { info: 'auth-signing-key-encryption', encoding: 'base64' },
  AUTH_RESET_REQUESTER_HMAC_KEY: { info: 'auth-reset-requester-hmac', encoding: 'hex' },
});

/** Values only the packaging derives, written to files by derive-secrets.mjs. */
export const PACKAGING_KEYS = Object.freeze({
  'storage-secret-key': { info: 'storage-secret-key', encoding: 'hex' },
  // The key every Permify call must carry (authn preshared).
  'permify-preshared-key': { info: 'permify-preshared-key', encoding: 'hex' },
  // The password Redis requires from every client (requirepass).
  'redis-password': { info: 'redis-password', encoding: 'hex' },
  // The password of the PostgreSQL superuser (cybedefend).
  'postgres-superuser-password': { info: 'postgres-superuser-password', encoding: 'hex' },
});

/**
 * The HKDF info of the key of one (caller, server) pair of the internal gRPC
 * calls (hex): the same as serviceAuthCommunityPairInfo() in
 * src/core/service-auth/service-auth.edition.ts.
 */
export function serviceAuthPairInfo(caller, server) {
  return `service-to-service-auth/${caller}/${server}`;
}

export class MasterKeyError extends Error {}

const MISSING_MESSAGE =
  'CYBEDEFEND_SECRET_KEY is required in the Community Edition. Set it to at least 32 random bytes, base64 or hex (for example: openssl rand -base64 32).';
const MALFORMED_MESSAGE = 'CYBEDEFEND_SECRET_KEY is neither hex nor base64.';

/**
 * All-hex with even length is read as hex, otherwise a base64/base64url string,
 * otherwise refused. Must decode to at least MIN_MASTER_KEY_BYTES bytes.
 */
export function decodeMasterKey(raw) {
  const value = (raw ?? '').trim();
  if (value === '') {
    throw new MasterKeyError(MISSING_MESSAGE);
  }
  let bytes;
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    bytes = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    bytes = Buffer.from(value, 'base64');
  } else {
    throw new MasterKeyError(MALFORMED_MESSAGE);
  }
  if (bytes.length < MIN_MASTER_KEY_BYTES) {
    throw new MasterKeyError(
      `CYBEDEFEND_SECRET_KEY must decode to at least ${MIN_MASTER_KEY_BYTES} bytes; it decodes to ${bytes.length}.`,
    );
  }
  return bytes;
}

export function deriveKey(master, info) {
  return Buffer.from(hkdfSync('sha256', master, COMMUNITY_HKDF_SALT, info, 32));
}
