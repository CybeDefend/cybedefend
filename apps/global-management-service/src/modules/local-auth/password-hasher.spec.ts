import { PasswordHasher } from './password-hasher';

/**
 * argon2id credentials: m=19456 KiB, t=2, p=1, hash prefix
 * `$argon2id$v=19$m=19456,t=2,p=1$`. `verify` throws only the gate's refusal (password-hash-gate.spec.ts): a malformed hash
 * answers false, and `verifyAgainstDummy` runs one real verification against
 * a hash made at construction so an unknown e-mail costs the same as a known
 * one (no account enumeration).
 */
describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with argon2id m=19456 t=2 p=1', async () => {
    expect(await hasher.hash('correct horse battery')).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it('verifies the right password only', async () => {
    const hash = await hasher.hash('correct horse battery');
    await expect(hasher.verify(hash, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(hasher.verify(hash, 'a wrong password')).resolves.toBe(false);
  });

  it('answers false to a malformed hash', async () => {
    await expect(hasher.verify('not-a-hash', 'whatever')).resolves.toBe(false);
    await expect(
      hasher.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$bm90LWJhc2U2NA$$',
        'whatever',
      ),
    ).resolves.toBe(false);
  });

  it('verifyAgainstDummy always answers false', async () => {
    await expect(
      hasher.verifyAgainstDummy('correct horse battery'),
    ).resolves.toBe(false);
    await expect(
      hasher.verifyAgainstDummy('anything else at all'),
    ).resolves.toBe(false);
  });
});
