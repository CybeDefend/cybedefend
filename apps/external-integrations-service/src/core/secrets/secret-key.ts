import { hkdfSync } from 'node:crypto';

export const MASTER_KEY_VARIABLE = 'CYBEDEFEND_SECRET_KEY';
export const COMMUNITY_HKDF_SALT = 'cybedefend-community';
export const MIN_MASTER_KEY_BYTES = 32;

export type KeyEncoding = 'hex' | 'base64';

export interface DerivedKeySpec {
  info: string;
  encoding: KeyEncoding;
}

/**
 * The five derived keys, each returned in the encoding its consumer decodes
 * today: hex (64 characters) for the three hex consumers, base64 for the
 * other two; plus AUTH_RESET_REQUESTER_HMAC_KEY (hex), the key of the HMAC
 * that stores a password-reset requester's address (LocalAuthModule's
 * ResetRequesterKeyer), under a label of its own.
 */
export const DERIVED_SECRET_KEYS: Readonly<Record<string, DerivedKeySpec>> = {
  CONTAINER_REGISTRY_ENCRYPTION_KEY: {
    info: 'container-registry-encryption',
    encoding: 'hex',
  },
  GITLAB_ENCRYPTION_KEY: { info: 'gitlab-encryption', encoding: 'hex' },
  SECRET_ENCRYPTION_KEY: {
    info: 'secret-finding-encryption',
    encoding: 'base64',
  },
  SCAN_METADATA_ENCRYPTION_KEY: {
    info: 'scan-metadata-encryption',
    encoding: 'hex',
  },
  AUTH_SIGNING_KEY_ENCRYPTION_KEY: {
    info: 'auth-signing-key-encryption',
    encoding: 'base64',
  },
  AUTH_RESET_REQUESTER_HMAC_KEY: {
    info: 'auth-reset-requester-hmac',
    encoding: 'hex',
  },
};

export class MasterKeyError extends Error {}

const MISSING_MESSAGE =
  'CYBEDEFEND_SECRET_KEY is required in the Community Edition. Set it to at least 32 random bytes, base64 or hex (for example: openssl rand -base64 32).';
const MALFORMED_MESSAGE = 'CYBEDEFEND_SECRET_KEY is neither hex nor base64.';

/**
 * Decodes the master key: all-hex with even length is read as hex, otherwise a
 * base64/base64url string (Node accepts base64url with 'base64'), otherwise
 * refused. Must decode to at least MIN_MASTER_KEY_BYTES bytes.
 */
export function decodeMasterKey(raw: string | undefined): Buffer {
  const value = (raw ?? '').trim();
  if (value === '') {
    throw new MasterKeyError(MISSING_MESSAGE);
  }
  let bytes: Buffer;
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

export function deriveKey(master: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, COMMUNITY_HKDF_SALT, info, 32));
}

export function encodeKey(key: Buffer, encoding: KeyEncoding): string {
  return key.toString(encoding);
}
