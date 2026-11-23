import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import SecretsService from '../secrets/secrets.service';

const KEY_SECRET_NAME = 'CONTAINER_REGISTRY_ENCRYPTION_KEY';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Encrypts the OAuth tokens an integration stores (AES-256-GCM).
 *
 * Same key and same stored format as the Jira integration: `iv:authTag:ciphertext`,
 * each part in hex, the key being 32 bytes of hex in `CONTAINER_REGISTRY_ENCRYPTION_KEY`.
 *
 * The key is read on first use, after the secrets cache is loaded, never in the
 * constructor: in a deployed pod the cache is empty until `onModuleInit` has run.
 */
@Injectable()
export class TokenCipherService {
  private encryptionKey: Buffer | null = null;

  constructor(private readonly secretsService: SecretsService) {}

  async encrypt(plain: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });

    let encrypted = cipher.update(plain, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  async decrypt(stored: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const parts = stored.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }
    const [ivHex, authTagHex, encrypted] = parts;

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex'),
      { authTagLength: AUTH_TAG_BYTES },
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private async getEncryptionKey(): Promise<Buffer> {
    if (this.encryptionKey) return this.encryptionKey;

    await this.secretsService.ensureCacheLoaded();
    const keyHex = this.secretsService.getSecret(KEY_SECRET_NAME);
    if (!keyHex) {
      throw new Error('Encryption key not found in secrets.');
    }
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('Encryption key must be exactly 32 bytes');
    }
    this.encryptionKey = key;
    return key;
  }
}
