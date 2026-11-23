import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * The at-rest seal of an `auth_signing_key` private key: AES-256-GCM
 * with the 32-byte `AUTH_SIGNING_KEY_ENCRYPTION_KEY` (derived from
 * CYBEDEFEND_SECRET_KEY in the Community Edition). The sealed form
 * is 'v1:' + base64(iv12) + ':' + base64(tag16) + ':' + base64(ciphertext).
 *
 * Every decryption failure — wrong key, tampered bytes, malformed seal — is
 * the same error, so nothing about the key or the stored value leaks through
 * the message. The seal and the key are never logged.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptPrivateKey(pem: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(pem, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptPrivateKey(sealed: string, key: Buffer): string {
  try {
    const parts = sealed.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('unexpected seal format');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('unexpected seal lengths');
    }
    // cybedefend-ignore[CD-SAST-1457]: the tag length is checked to be 16 bytes just above, so a truncated tag is refused before decryption
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('AUTH_SIGNING_KEY_UNREADABLE');
  }
}
