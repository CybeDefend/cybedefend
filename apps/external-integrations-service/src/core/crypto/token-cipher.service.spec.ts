import { TokenCipherService } from './token-cipher.service';

const KEY_HEX = 'a1'.repeat(32);

function makeSecrets(keyHex: string | undefined) {
  return {
    ensureCacheLoaded: jest.fn().mockResolvedValue(undefined),
    getSecret: jest.fn((key: string) =>
      key === 'CONTAINER_REGISTRY_ENCRYPTION_KEY' ? keyHex : undefined,
    ),
  };
}

describe('TokenCipherService', () => {
  it('round-trips a token', async () => {
    const service = new TokenCipherService(makeSecrets(KEY_HEX) as any);

    const stored = await service.encrypt('lin_oauth_secret-token');

    await expect(service.decrypt(stored)).resolves.toBe(
      'lin_oauth_secret-token',
    );
  });

  it('never returns the plain token', async () => {
    const service = new TokenCipherService(makeSecrets(KEY_HEX) as any);

    const stored = await service.encrypt('lin_oauth_secret-token');

    expect(stored).not.toContain('lin_oauth_secret-token');
    expect(stored).not.toContain(
      Buffer.from('lin_oauth_secret-token').toString('hex'),
    );
  });

  it('stores iv:authTag:ciphertext in hex with a 12-byte IV and a 16-byte tag', async () => {
    const service = new TokenCipherService(makeSecrets(KEY_HEX) as any);

    const stored = await service.encrypt('token');
    const [iv, authTag, ciphertext] = stored.split(':');

    expect(stored.split(':')).toHaveLength(3);
    expect(iv).toMatch(/^[0-9a-f]{24}$/);
    expect(authTag).toMatch(/^[0-9a-f]{32}$/);
    expect(ciphertext).toMatch(/^[0-9a-f]+$/);
  });

  it('uses a fresh IV for every encryption', async () => {
    const service = new TokenCipherService(makeSecrets(KEY_HEX) as any);

    const first = await service.encrypt('token');
    const second = await service.encrypt('token');

    expect(first).not.toBe(second);
  });

  it('refuses a stored value that was tampered with', async () => {
    const service = new TokenCipherService(makeSecrets(KEY_HEX) as any);
    const [iv, authTag, ciphertext] = (await service.encrypt('token')).split(
      ':',
    );
    const flipped = (ciphertext[0] === '0' ? '1' : '0') + ciphertext.slice(1);

    await expect(
      service.decrypt(`${iv}:${authTag}:${flipped}`),
    ).rejects.toThrow();
  });

  it('refuses a stored value that is not in the iv:authTag:ciphertext format', async () => {
    const service = new TokenCipherService(makeSecrets(KEY_HEX) as any);

    await expect(service.decrypt('not-a-stored-token')).rejects.toThrow(
      'Invalid encrypted token format',
    );
  });

  it('throws when the key is not 32 bytes', async () => {
    const service = new TokenCipherService(makeSecrets('a1'.repeat(16)) as any);

    await expect(service.encrypt('token')).rejects.toThrow(
      'Encryption key must be exactly 32 bytes',
    );
  });

  it('keeps refusing after a bad key instead of memoising it', async () => {
    const service = new TokenCipherService(makeSecrets('a1'.repeat(16)) as any);

    await expect(service.encrypt('token')).rejects.toThrow();
    await expect(service.encrypt('token')).rejects.toThrow(
      'Encryption key must be exactly 32 bytes',
    );
  });

  it('throws when the key is missing from the secrets', async () => {
    const service = new TokenCipherService(makeSecrets(undefined) as any);

    await expect(service.encrypt('token')).rejects.toThrow(
      'Encryption key not found in secrets.',
    );
  });

  it('loads the secrets cache before reading the key and reads it once', async () => {
    const secrets = makeSecrets(KEY_HEX);
    const service = new TokenCipherService(secrets as any);

    await service.encrypt('a');
    await service.encrypt('b');

    expect(secrets.ensureCacheLoaded).toHaveBeenCalledTimes(1);
    expect(secrets.getSecret).toHaveBeenCalledTimes(1);
    expect(secrets.ensureCacheLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      secrets.getSecret.mock.invocationCallOrder[0],
    );
  });

  it('does not read the key in the constructor', () => {
    const secrets = makeSecrets(KEY_HEX);

    new TokenCipherService(secrets as any);

    expect(secrets.getSecret).not.toHaveBeenCalled();
    expect(secrets.ensureCacheLoaded).not.toHaveBeenCalled();
  });
});
