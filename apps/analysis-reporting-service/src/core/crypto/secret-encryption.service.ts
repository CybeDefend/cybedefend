import { Injectable, OnModuleInit } from '@nestjs/common';
import * as crypto from 'node:crypto';
import SecretsService from '../secrets/secrets.service';

const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const HASH_KEY_INFO = 'secret-value-hash';

@Injectable()
export class SecretEncryptionService implements OnModuleInit {
  private key: Buffer;
  private hashKey: Buffer;

  constructor(private readonly secretsService: SecretsService) {}

  onModuleInit(): void {
    const raw =
      this.secretsService.getSecret('SECRET_ENCRYPTION_KEY') ??
      process.env.SECRET_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        'SECRET_ENCRYPTION_KEY is not set — refusing to start the service',
      );
    }
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        `SECRET_ENCRYPTION_KEY must be 32 bytes (got ${decoded.length})`,
      );
    }
    this.key = decoded;
    // A sub-key of its own, so the hash key is never the encryption key.
    this.hashKey = Buffer.from(
      crypto.hkdfSync(
        'sha256',
        decoded,
        Buffer.alloc(0),
        HASH_KEY_INFO,
        KEY_LENGTH_BYTES,
      ),
    );
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${ENVELOPE_VERSION}:${iv.toString('hex')}:${ciphertext.toString(
      'hex',
    )}:${tag.toString('hex')}`;
  }

  /**
   * Deterministic keyed hash of a secret value (lowercase hex HMAC-SHA256).
   * `encrypt` uses a random IV, so two encryptions of one value cannot be
   * compared; this hash can, without storing anything reversible.
   */
  hashSecretValue(value: string): string {
    return crypto
      .createHmac('sha256', this.hashKey)
      .update(value, 'utf8')
      .digest('hex');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 4) {
      throw new Error('secret encryption envelope is malformed');
    }
    const [version, ivHex, ctHex, tagHex] = parts;
    if (version !== ENVELOPE_VERSION) {
      throw new Error(`unknown encryption version: ${version}`);
    }
    const iv = Buffer.from(ivHex, 'hex');
    const ciphertext = Buffer.from(ctHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    if (iv.length !== IV_LENGTH_BYTES) {
      throw new Error('invalid IV length');
    }
    if (tag.length !== AUTH_TAG_LENGTH_BYTES) {
      throw new Error('invalid auth tag length');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
