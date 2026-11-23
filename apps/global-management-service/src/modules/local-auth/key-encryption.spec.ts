import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { decryptPrivateKey, encryptPrivateKey } from './key-encryption';

/**
 * The sealed private key of `auth_signing_key`: AES-256-GCM with the
 * 32-byte `AUTH_SIGNING_KEY_ENCRYPTION_KEY`, sealed as
 * 'v1:' + base64(iv12) + ':' + base64(tag16) + ':' + base64(ciphertext).
 * Every decryption failure is the same error, so nothing about the key, the
 * seal or the stored value leaks through the message.
 */
describe('key-encryption', () => {
  const key = randomBytes(32);
  // A PEM generated at test time (no key material in the source): the seal
  // carries bytes, the PEM is the caller's.
  const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

  it('round-trips a PEM', () => {
    const sealed = encryptPrivateKey(pem, key);
    expect(sealed.startsWith('v1:')).toBe(true);
    const parts = sealed.split(':');
    expect(parts).toHaveLength(4);
    // iv 12 bytes, tag 16 bytes, both base64 in their part
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64')).toHaveLength(16);
    expect(decryptPrivateKey(sealed, key)).toBe(pem);
  });

  it('a changed byte gives AUTH_SIGNING_KEY_UNREADABLE', () => {
    const sealed = encryptPrivateKey(pem, key);
    const parts = sealed.split(':');
    const ciphertext = parts[3];
    const tampered = ciphertext.startsWith('A')
      ? `B${ciphertext.slice(1)}`
      : `A${ciphertext.slice(1)}`;
    expect(() =>
      decryptPrivateKey(`v1:${parts[1]}:${parts[2]}:${tampered}`, key),
    ).toThrow('AUTH_SIGNING_KEY_UNREADABLE');
  });

  // GCM in Node accepts a truncated tag unless its length is checked: a
  // shorter tag would make a forged seal cheaper to find.
  it.each([4, 8, 12, 15])(
    'a tag truncated to %i bytes gives the same error',
    (bytes) => {
      const parts = encryptPrivateKey(pem, key).split(':');
      const tag = Buffer.from(parts[2], 'base64').subarray(0, bytes);
      expect(() =>
        decryptPrivateKey(
          `v1:${parts[1]}:${tag.toString('base64')}:${parts[3]}`,
          key,
        ),
      ).toThrow('AUTH_SIGNING_KEY_UNREADABLE');
    },
  );

  it('another key gives the same error', () => {
    const sealed = encryptPrivateKey(pem, key);
    expect(() => decryptPrivateKey(sealed, randomBytes(32))).toThrow(
      'AUTH_SIGNING_KEY_UNREADABLE',
    );
  });

  it('a malformed sealed value gives the same error', () => {
    expect(() => decryptPrivateKey('not-a-sealed-value', key)).toThrow(
      'AUTH_SIGNING_KEY_UNREADABLE',
    );
    expect(() => decryptPrivateKey('v1:only:two', key)).toThrow(
      'AUTH_SIGNING_KEY_UNREADABLE',
    );
    expect(() => decryptPrivateKey('v2:aaa:bbb:ccc', key)).toThrow(
      'AUTH_SIGNING_KEY_UNREADABLE',
    );
  });
});
