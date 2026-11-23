import { createHash, randomBytes } from 'node:crypto';

/**
 * The opaque tokens of the local auth and the
 * stored form of every one of them. The token itself is never stored or
 * logged; only its SHA-256 hash is.
 */

/** A new opaque token: 32 random bytes, base64url (43 characters). */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored form of a token: SHA-256, hex (64 characters). */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
