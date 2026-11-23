import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { withAdvisoryLock } from '@cybedefend/db-dialect';
import SecretsService from 'src/core/secrets/secrets.service';
import { AuthSigningKey } from './entities/auth-signing-key.entity';
import { decryptPrivateKey, encryptPrivateKey } from './key-encryption';

/**
 * The Community Edition's ES256 signing keys, one row of
 * `auth_signing_key` per key: the private key is stored AES-256-GCM sealed
 * with `AUTH_SIGNING_KEY_ENCRYPTION_KEY` (base64, 32 bytes; derived from
 * CYBEDEFEND_SECRET_KEY by the community secrets source), the public
 * key as the JWK GetJwks serves. No key is ever logged.
 *
 * `kid` is the base64url of the first 16 bytes of the SHA-256 of the public
 * key's DER. The first boot creates one key under the advisory lock
 * 'cybedefend_auth_signing_key', so two replicas booting together create one.
 */
export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  alg: 'ES256';
  use: 'sig';
}

const ENCRYPTION_KEY_SECRET = 'AUTH_SIGNING_KEY_ENCRYPTION_KEY';
const SIGNING_KEY_LOCK = 'cybedefend_auth_signing_key';
const SIGNING_KEY_LOCK_TIMEOUT_S = 10;
const CURRENT_KEY_CACHE_MS = 60_000;

interface CurrentKey {
  kid: string;
  privateKey: KeyObject;
}

function generateSigningKey(): {
  kid: string;
  privateKeyPem: string;
  publicJwk: PublicJwk;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const kid = createHash('sha256')
    .update(der)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.x === undefined || jwk.y === undefined) {
    throw new Error('AUTH_SIGNING_KEY_UNREADABLE');
  }
  return {
    kid,
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicJwk: {
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

@Injectable()
export class SigningKeyService implements OnModuleInit {
  private cache: { result: CurrentKey; fetchedAt: number } | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly secrets: SecretsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // A secrets source may fill its cache asynchronously: read the key only
    // once it is loaded, in onModuleInit after secrets.ensureCacheLoaded():
    // a read in the constructor would see an empty cache.
    await this.secrets.ensureCacheLoaded();
    // Fail fast: without the encryption key no stored key can be read.
    this.encryptionKey();
    await this.ensureSigningKey();
  }

  /**
   * Creates the instance's first key when none is unretired. The lock runs on
   * one QueryRunner connection, so a second replica re-counts after the
   * first has inserted; a lock not obtained in 10 s throws and the boot fails.
   */
  async ensureSigningKey(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await withAdvisoryLock(
        runner,
        SIGNING_KEY_LOCK,
        SIGNING_KEY_LOCK_TIMEOUT_S,
        async () => {
          const unretired = await runner.manager
            .getRepository(AuthSigningKey)
            .createQueryBuilder('k')
            .where('k.retiredAt IS NULL')
            .getCount();
          if (unretired > 0) {
            return;
          }
          const { kid, privateKeyPem, publicJwk } = generateSigningKey();
          await runner.manager.getRepository(AuthSigningKey).insert({
            kid,
            privateKeyEncrypted: encryptPrivateKey(
              privateKeyPem,
              this.encryptionKey(),
            ),
            publicJwk: JSON.stringify(publicJwk),
          });
          this.cache = null;
        },
      );
    } finally {
      await runner.release();
    }
  }

  /** The newest unretired key (created_at DESC, kid DESC), cached 60 s. */
  async currentKey(): Promise<CurrentKey> {
    if (
      this.cache !== null &&
      Date.now() - this.cache.fetchedAt < CURRENT_KEY_CACHE_MS
    ) {
      return this.cache.result;
    }
    const row = await this.dataSource.getRepository(AuthSigningKey).findOne({
      where: { retiredAt: IsNull() },
      order: { createdAt: 'DESC', kid: 'DESC' },
    });
    if (row === null) {
      throw new Error('AUTH_SIGNING_KEY_UNREADABLE');
    }
    const result: CurrentKey = {
      kid: row.kid,
      privateKey: createPrivateKey(
        decryptPrivateKey(row.privateKeyEncrypted, this.encryptionKey()),
      ),
    };
    this.cache = { result, fetchedAt: Date.now() };
    return result;
  }

  /** Every unretired key, newest first, as GetJwks serves them. */
  async jwks(): Promise<PublicJwk[]> {
    const rows = await this.dataSource.getRepository(AuthSigningKey).find({
      where: { retiredAt: IsNull() },
      order: { createdAt: 'DESC', kid: 'DESC' },
    });
    return rows.map((row) => JSON.parse(row.publicJwk) as PublicJwk);
  }

  private encryptionKey(): Buffer {
    const raw = this.secrets.getSecret(ENCRYPTION_KEY_SECRET);
    const key = raw === undefined ? undefined : Buffer.from(raw, 'base64');
    if (key === undefined || key.length !== 32) {
      throw new Error(
        `${ENCRYPTION_KEY_SECRET} is missing or not 32 bytes: set CYBEDEFEND_SECRET_KEY`,
      );
    }
    return key;
  }
}
