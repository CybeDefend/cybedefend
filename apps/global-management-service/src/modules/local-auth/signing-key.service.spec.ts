import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { FindOperator } from 'typeorm';
import type SecretsService from 'src/core/secrets/secrets.service';
import { encryptPrivateKey } from './key-encryption';
import { SigningKeyService, type PublicJwk } from './signing-key.service';
import type { AuthSigningKey } from './entities/auth-signing-key.entity';

/**
 * Unit spec of the ES256 signing key service: boot refuses to start
 * without a usable `AUTH_SIGNING_KEY_ENCRYPTION_KEY`, JWKS publishes only
 * unretired keys, and the current key is the newest unretired one, decrypted
 * and cached for 60 s. The concurrent first boot is pinned by the live spec.
 */
describe('SigningKeyService (unit)', () => {
  const encryptionKey = randomBytes(32);
  const secrets = {
    ensureCacheLoaded: async (): Promise<void> => undefined,
    getSecret: (key: string): string | undefined =>
      key === 'AUTH_SIGNING_KEY_ENCRYPTION_KEY'
        ? encryptionKey.toString('base64')
        : undefined,
  } as unknown as SecretsService;

  function makeService(repo: {
    find: jest.Mock;
    findOne: jest.Mock;
  }): SigningKeyService {
    const dataSource = {
      getRepository: jest.fn(() => repo),
    } as unknown as DataSource;
    return new SigningKeyService(dataSource, secrets);
  }

  function makeKeyMaterial(): {
    kid: string;
    pem: string;
    jwk: PublicJwk;
  } {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const kid = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest()
      .subarray(0, 16)
      .toString('base64url');
    const jwk = publicKey.export({ format: 'jwk' }) as {
      kty: string;
      crv: string;
      x: string;
      y: string;
    };
    return {
      kid,
      pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      jwk: {
        kty: 'EC',
        crv: 'P-256',
        x: jwk.x,
        y: jwk.y,
        kid,
        alg: 'ES256',
        use: 'sig',
      },
    };
  }

  it('refuses to boot without the encryption key', async () => {
    const emptySecrets = {
      ensureCacheLoaded: async (): Promise<void> => undefined,
      getSecret: (): string | undefined => undefined,
    } as unknown as SecretsService;
    const service = new SigningKeyService(
      { getRepository: jest.fn() } as unknown as DataSource,
      emptySecrets,
    );
    await expect(service.onModuleInit()).rejects.toThrow(
      'AUTH_SIGNING_KEY_ENCRYPTION_KEY is missing or not 32 bytes: set CYBEDEFEND_SECRET_KEY',
    );

    // base64 that decodes to 16 bytes, not 32: same refusal
    const shortSecrets = {
      ensureCacheLoaded: async (): Promise<void> => undefined,
      getSecret: (): string | undefined => randomBytes(16).toString('base64'),
    } as unknown as SecretsService;
    const shortService = new SigningKeyService(
      { getRepository: jest.fn() } as unknown as DataSource,
      shortSecrets,
    );
    await expect(shortService.onModuleInit()).rejects.toThrow(
      'AUTH_SIGNING_KEY_ENCRYPTION_KEY is missing or not 32 bytes: set CYBEDEFEND_SECRET_KEY',
    );
  });

  it('reads the encryption key only once the secrets cache is loaded', async () => {
    // The cloud secrets source fills its cache asynchronously: a key read
    // before ensureCacheLoaded() resolves is undefined: read it in
    // onModuleInit after await secrets.ensureCacheLoaded().
    let loaded = false;
    const lateSecrets = {
      ensureCacheLoaded: async (): Promise<void> => {
        await Promise.resolve();
        loaded = true;
      },
      getSecret: (key: string): string | undefined =>
        loaded && key === 'AUTH_SIGNING_KEY_ENCRYPTION_KEY'
          ? encryptionKey.toString('base64')
          : undefined,
    } as unknown as SecretsService;
    const service = new SigningKeyService(
      { getRepository: jest.fn() } as unknown as DataSource,
      lateSecrets,
    );
    const ensure = jest
      .spyOn(service, 'ensureSigningKey')
      .mockResolvedValue(undefined);
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('publishes only unretired keys', async () => {
    const active = makeKeyMaterial();
    const retired = makeKeyMaterial();
    const rows: Partial<AuthSigningKey>[] = [
      {
        kid: active.kid,
        publicJwk: JSON.stringify(active.jwk),
        retiredAt: null,
      },
      {
        kid: retired.kid,
        publicJwk: JSON.stringify(retired.jwk),
        retiredAt: new Date(),
      },
    ];
    const repo = {
      // as the database would answer the query: only the unretired rows
      find: jest.fn<Promise<Partial<AuthSigningKey>[]>, [unknown]>(async () =>
        rows.filter((r) => r.retiredAt === null),
      ),
      findOne: jest.fn<Promise<Partial<AuthSigningKey> | null>, [unknown]>(
        async () => null,
      ),
    };
    const service = makeService(repo);

    const jwks = await service.jwks();

    expect(repo.find).toHaveBeenCalledTimes(1);
    const options = repo.find.mock.calls[0][0] as {
      where: { retiredAt: FindOperator<unknown> };
      order: Record<string, string>;
    };
    expect(options.where.retiredAt).toBeInstanceOf(FindOperator);
    expect(options.where.retiredAt.type).toBe('isNull');
    expect(options.order).toEqual({ createdAt: 'DESC', kid: 'DESC' });
    expect(jwks).toEqual([active.jwk]);
  });

  it('currentKey decrypts the newest unretired key and caches it for 60 s', async () => {
    const material = makeKeyMaterial();
    const row: Partial<AuthSigningKey> = {
      kid: material.kid,
      privateKeyEncrypted: encryptPrivateKey(material.pem, encryptionKey),
      publicJwk: JSON.stringify(material.jwk),
      retiredAt: null,
    };
    const repo = {
      find: jest.fn<Promise<Partial<AuthSigningKey>[]>, [unknown]>(
        async () => [],
      ),
      findOne: jest.fn<Promise<Partial<AuthSigningKey> | null>, [unknown]>(
        async () => row,
      ),
    };
    const service = makeService(repo);

    const first = await service.currentKey();
    const second = await service.currentKey();

    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(repo.findOne.mock.calls[0][0]).toEqual({
      where: { retiredAt: expect.any(FindOperator) },
      order: { createdAt: 'DESC', kid: 'DESC' },
    });
    expect(first.kid).toBe(material.kid);
    expect(first.privateKey.type).toBe('private');
    expect(
      first.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    ).toBe(material.pem);
    expect(second).toBe(first);
  });
});
