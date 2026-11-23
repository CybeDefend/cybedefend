import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DERIVED_SECRET_KEYS,
  MasterKeyError,
  decodeMasterKey,
  deriveKey,
  encodeKey,
} from './secret-key';

interface MasterKeyVector {
  hex?: string;
  base64?: string;
  derived: Record<string, string>;
}

interface Vectors {
  salt: string;
  masterKeys: MasterKeyVector[];
}

const vectors: Vectors = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../../libs/test-fixtures/secrets/hkdf-vectors.json',
    ),
    'utf8',
  ),
);

describe('secret-key', () => {
  it('derives the vectors of hkdf-vectors.json', () => {
    for (const mk of vectors.masterKeys) {
      const master = decodeMasterKey(mk.hex ?? mk.base64);
      for (const [name, value] of Object.entries(mk.derived)) {
        const spec = DERIVED_SECRET_KEYS[name];
        expect(spec).toBeDefined();
        expect(encodeKey(deriveKey(master, spec.info), spec.encoding)).toBe(
          value,
        );
      }
    }
  });

  it('decodes the same 32 bytes from hex, base64 and base64url', () => {
    const mk = vectors.masterKeys[0];
    const fromHex = decodeMasterKey(mk.hex as string);
    const fromB64 = decodeMasterKey(mk.base64 as string);
    expect(fromHex.equals(fromB64)).toBe(true);
    const base64url = (mk.base64 as string)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeMasterKey(base64url).equals(fromHex)).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const mk = vectors.masterKeys[0];
    expect(
      decodeMasterKey('  ' + (mk.hex as string) + '\n').equals(
        decodeMasterKey(mk.hex),
      ),
    ).toBe(true);
  });

  it('refuses an absent or empty key with the fixed message', () => {
    const message =
      'CYBEDEFEND_SECRET_KEY is required in the Community Edition. Set it to at least 32 random bytes, base64 or hex (for example: openssl rand -base64 32).';
    expect(() => decodeMasterKey(undefined)).toThrow(message);
    expect(() => decodeMasterKey('')).toThrow(message);
    expect(() => decodeMasterKey(undefined)).toThrow(MasterKeyError);
    expect(() => decodeMasterKey('   ')).toThrow(message);
  });

  it('refuses a key shorter than 32 bytes', () => {
    expect(() => decodeMasterKey('ab'.repeat(31))).toThrow(
      'CYBEDEFEND_SECRET_KEY must decode to at least 32 bytes; it decodes to 31.',
    );
  });

  it('refuses a value that is neither hex nor base64', () => {
    expect(() => decodeMasterKey('not a key!')).toThrow(
      'CYBEDEFEND_SECRET_KEY is neither hex nor base64.',
    );
  });

  it('derives the reset requester HMAC key under its own label (pinned on the first vector master key)', () => {
    const master = decodeMasterKey(vectors.masterKeys[0].hex);
    const spec = DERIVED_SECRET_KEYS.AUTH_RESET_REQUESTER_HMAC_KEY;
    expect(spec).toEqual({
      info: 'auth-reset-requester-hmac',
      encoding: 'hex',
    });
    expect(encodeKey(deriveKey(master, spec.info), spec.encoding)).toBe(
      '1a51a4d879b1b01b7049229e7932655e1ec191586ac8353f141bc8e4bc3699ba',
    );
    // its own label: never the value of another derived key
    for (const [name, other] of Object.entries(DERIVED_SECRET_KEYS)) {
      if (name === 'AUTH_RESET_REQUESTER_HMAC_KEY') continue;
      expect(other.info).not.toBe(spec.info);
    }
  });

  it('lists exactly the five secret keys and the reset requester key', () => {
    expect(DERIVED_SECRET_KEYS).toEqual({
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
    });
  });
});
