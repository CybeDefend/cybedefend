import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import {
  createLiveDatabase,
  liveDialect,
  type LiveDatabase,
} from 'src/core/db/live-database';
import { LIVE_ENTITIES_GLOB } from 'src/core/db/typeorm-options';
import type SecretsService from 'src/core/secrets/secrets.service';
import { AuthSigningKey } from './entities/auth-signing-key.entity';
import { SigningKeyService } from './signing-key.service';

/**
 * LIVE spec of the signing key service: two concurrent first boots
 * on one database create exactly one key (the advisory lock
 * 'cybedefend_auth_signing_key' serialises them on both engines), and a later
 * boot creates no second one. The created key is usable: currentKey decrypts
 * it and jwks publishes it.
 *
 * Skipped unless LOCAL_AUTH_LIVE=1. One run per engine, both must pass:
 *
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=mysql GM_MYSQL_URL=mysql://root:<password>@127.0.0.1:13308 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=signing-key.service.live
 *   LOCAL_AUTH_LIVE=1 LIVE_DB_TYPE=postgres GM_PG_URL=postgres://postgres:<password>@127.0.0.1:15432 \
 *     pnpm exec jest --ci --runInBand --testPathPatterns=signing-key.service.live
 */
const LIVE = process.env.LOCAL_AUTH_LIVE === '1';
const describeLive = LIVE ? describe : describe.skip;

/** The service root (`src/`), where the entity globs point. */
const ROOT = join(__dirname, '..', '..');
const LOCAL_AUTH_ENTITIES = join(
  ROOT,
  'modules',
  'local-auth',
  'entities',
  '*.entity{.ts,.js}',
);

describeLive('SigningKeyService on a real database', () => {
  jest.setTimeout(300_000);

  let live: LiveDatabase;
  let dataSource: DataSource;

  // A valid 32-byte encryption key, base64 as the secrets source encodes it.
  const encryptionKey = randomBytes(32);
  const secrets = {
    ensureCacheLoaded: async (): Promise<void> => undefined,
    getSecret: (key: string): string | undefined =>
      key === 'AUTH_SIGNING_KEY_ENCRYPTION_KEY'
        ? encryptionKey.toString('base64')
        : undefined,
  } as unknown as SecretsService;

  beforeAll(async () => {
    const dialect = liveDialect('GM');
    live = await createLiveDatabase({
      prefix: 'gm_signing_key',
      envPrefix: 'GM',
      entities: [LIVE_ENTITIES_GLOB, LOCAL_AUTH_ENTITIES],
      // the engine's own pool option (contract issue 15)
      extra: dialect === 'postgres' ? { max: 5 } : { connectionLimit: 5 },
    });
    dataSource = live.dataSource;
  });

  afterAll(async () => {
    await live?.drop();
  });

  it('two concurrent first boots create one key', async () => {
    const a = new SigningKeyService(dataSource, secrets);
    const b = new SigningKeyService(dataSource, secrets);
    await Promise.all([a.ensureSigningKey(), b.ensureSigningKey()]);
    expect(await dataSource.getRepository(AuthSigningKey).count()).toBe(1);
  });

  it('a later boot creates no second key, and the key is usable', async () => {
    const c = new SigningKeyService(dataSource, secrets);
    await c.ensureSigningKey();
    expect(await dataSource.getRepository(AuthSigningKey).count()).toBe(1);

    const { kid, privateKey } = await c.currentKey();
    // kid = base64url of the first 16 bytes of the SHA-256 of the public DER
    expect(kid).toHaveLength(22);
    expect(privateKey.type).toBe('private');

    const jwks = await c.jwks();
    expect(jwks).toHaveLength(1);
    expect(jwks[0].kid).toBe(kid);
    expect(jwks[0].kty).toBe('EC');
    expect(jwks[0].crv).toBe('P-256');
    expect(jwks[0].alg).toBe('ES256');
    expect(jwks[0].use).toBe('sig');
    expect(typeof jwks[0].x).toBe('string');
    expect(typeof jwks[0].y).toBe('string');
  });
});
