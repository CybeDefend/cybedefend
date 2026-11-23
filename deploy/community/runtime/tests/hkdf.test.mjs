import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMasterKey, deriveKey, DERIVED_SECRET_KEYS, PACKAGING_KEYS } from '../hkdf.mjs';
import { loadVectors } from './vectors.mjs';

const vectors = loadVectors();

test('derives the vectors of hkdf-vectors.json', () => {
  assert.equal(vectors.salt, 'cybedefend-community');
  let checked = 0;
  for (const entry of vectors.masterKeys) {
    const forms = [entry.hex, entry.base64].filter((form) => typeof form === 'string');
    assert.ok(forms.length > 0);
    for (const form of forms) {
      const master = decodeMasterKey(form);
      for (const [key, expected] of Object.entries(entry.derived ?? {})) {
        const spec = DERIVED_SECRET_KEYS[key];
        assert.ok(spec, `unknown derived key ${key}`);
        assert.equal(deriveKey(master, spec.info).toString(spec.encoding), expected, `${key} from ${form}`);
        checked += 1;
      }
      for (const [name, expected] of Object.entries(entry.packaging ?? {})) {
        const spec = PACKAGING_KEYS[name];
        assert.ok(spec, `unknown packaging key ${name}`);
        assert.equal(deriveKey(master, spec.info).toString(spec.encoding), expected, `${name} from ${form}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 13, `only ${checked} vectors checked`);
});

test('a derived key is 32 bytes', () => {
  const master = decodeMasterKey(vectors.masterKeys[0].hex);
  assert.equal(deriveKey(master, 'storage-secret-key').length, 32);
});

test('refuses a short key with the same message as the services', () => {
  assert.throws(
    () => decodeMasterKey('00112233'),
    { message: 'CYBEDEFEND_SECRET_KEY must decode to at least 32 bytes; it decodes to 4.' },
  );
  assert.throws(
    () => decodeMasterKey('   '),
    {
      message:
        'CYBEDEFEND_SECRET_KEY is required in the Community Edition. Set it to at least 32 random bytes, base64 or hex (for example: openssl rand -base64 32).',
    },
  );
  assert.throws(() => decodeMasterKey(undefined), /is required in the Community Edition/);
  assert.throws(() => decodeMasterKey('not a key!'), { message: 'CYBEDEFEND_SECRET_KEY is neither hex nor base64.' });
});
