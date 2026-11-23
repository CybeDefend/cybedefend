import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { SecretEncryptionService } from './secret-encryption.service';
import SecretsService from '../secrets/secrets.service';

describe('SecretEncryptionService', () => {
  let service: SecretEncryptionService;
  // 32-byte key, base64-encoded — deterministic for tests
  const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

  const buildService = async (
    key: string | undefined,
  ): Promise<SecretEncryptionService> => {
    const original = process.env.SECRET_ENCRYPTION_KEY;
    if (key === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = key;
    try {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SecretEncryptionService,
          {
            provide: SecretsService,
            useValue: { getSecret: () => undefined },
          },
        ],
      }).compile();
      const svc = module.get(SecretEncryptionService);
      await svc.onModuleInit();
      return svc;
    } finally {
      if (original === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
      else process.env.SECRET_ENCRYPTION_KEY = original;
    }
  };

  beforeEach(async () => {
    service = await buildService(VALID_KEY);
  });

  it('encrypts plaintext into a v1: envelope', () => {
    const envelope = service.encrypt('AKIAIOSFODNN7EXAMPLE');
    expect(envelope).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('roundtrip preserves the plaintext', () => {
    const plaintext = 'hunter2-with-special-chars-!@#$%';
    const envelope = service.encrypt(plaintext);
    expect(service.decrypt(envelope)).toBe(plaintext);
  });

  it('produces a different envelope for the same plaintext (random IV)', () => {
    const a = service.encrypt('same');
    const b = service.encrypt('same');
    expect(a).not.toEqual(b);
    expect(service.decrypt(a)).toBe(service.decrypt(b));
  });

  it('decrypt throws on unknown version prefix', () => {
    const bogus = 'v2:aa:bb:cc';
    expect(() => service.decrypt(bogus)).toThrow(/unknown encryption version/i);
  });

  it('decrypt throws on tampered ciphertext (GCM auth failure)', () => {
    const envelope = service.encrypt('original');
    const parts = envelope.split(':');
    // Flip one byte in the ciphertext
    parts[2] = parts[2].replace(/^[0-9a-f]/, (c) => (c === '0' ? '1' : '0'));
    const tampered = parts.join(':');
    expect(() => service.decrypt(tampered)).toThrow();
  });

  // GCM in Node accepts a truncated tag unless its length is checked: a
  // shorter tag would make a forged envelope cheaper to find.
  it.each([4, 8, 12, 15])(
    'decrypt refuses an auth tag truncated to %i bytes',
    (bytes) => {
      const parts = service.encrypt('original').split(':');
      parts[3] = parts[3].slice(0, bytes * 2);
      expect(() => service.decrypt(parts.join(':'))).toThrow(
        /invalid auth tag length/,
      );
    },
  );

  it('throws at boot if SECRET_ENCRYPTION_KEY is missing', async () => {
    await expect(buildService(undefined)).rejects.toThrow(
      /SECRET_ENCRYPTION_KEY/,
    );
  });

  it('throws at boot if SECRET_ENCRYPTION_KEY is not 32 bytes', async () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    await expect(buildService(shortKey)).rejects.toThrow(/32 bytes/);
  });

  describe('hashSecretValue', () => {
    it('hashSecretValue is stable for one value and differs between values', () => {
      expect(service.hashSecretValue('abc')).toBe(
        service.hashSecretValue('abc'),
      );
      expect(service.hashSecretValue('abc')).not.toBe(
        service.hashSecretValue('abd'),
      );
      expect(service.hashSecretValue('abc')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashSecretValue depends on the encryption key', async () => {
      const other = await buildService(Buffer.alloc(32, 9).toString('base64'));
      expect(other.hashSecretValue('abc')).not.toBe(
        service.hashSecretValue('abc'),
      );
    });

    it('hashSecretValue never equals a plain sha256 of the value', () => {
      const plain = createHash('sha256').update('abc').digest('hex');
      expect(service.hashSecretValue('abc')).not.toBe(plain);
    });
  });
});
