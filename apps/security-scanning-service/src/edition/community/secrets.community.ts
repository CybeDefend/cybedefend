import { Injectable, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import {
  DERIVED_SECRET_KEYS,
  MASTER_KEY_VARIABLE,
  MasterKeyError,
  decodeMasterKey,
  deriveKey,
  encodeKey,
} from '../../core/secrets/secret-key';
import type { SecretsSource } from '../ports/secrets.port';

/**
 * The Community Edition's secrets source. Precedence for a key K:
 * process.env[K] when neither undefined nor '' → the content of the file named
 * by process.env[K + '_FILE'] (trailing whitespace removed, read once per
 * process) → the value derived from CYBEDEFEND_SECRET_KEY when K is one of
 * DERIVED_SECRET_KEYS → process.env[K] as is (undefined or '').
 *
 * The master key is optional: the Community packaging derives each key once,
 * in its init job, and hands every container only the keys it reads, as
 * <KEY>_FILE. When it is set, a malformed one still stops the boot.
 */
@Injectable()
export class CommunitySecretsSource implements SecretsSource, OnModuleInit {
  private readonly fileCache = new Map<string, string>();
  private readonly derivedCache = new Map<string, string>();
  private masterKeyBytes: Buffer | null = null;

  async onModuleInit(): Promise<void> {
    // Fail fast on a master key that is set but unusable.
    if (this.rawMasterKey() !== undefined) {
      this.masterKey();
    }
  }

  getSecret(key: string): string | undefined {
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && fromEnv !== '') {
      return fromEnv;
    }
    const fromFile = this.readFileValue(key);
    if (fromFile !== undefined) {
      return fromFile;
    }
    const spec = DERIVED_SECRET_KEYS[key];
    if (spec !== undefined) {
      const cached = this.derivedCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      if (this.rawMasterKey() === undefined) {
        throw new MasterKeyError(
          `${key} is not set: set ${key}_FILE, or ${MASTER_KEY_VARIABLE} to derive it.`,
        );
      }
      const value = encodeKey(
        deriveKey(this.masterKey(), spec.info),
        spec.encoding,
      );
      this.derivedCache.set(key, value);
      return value;
    }
    return fromEnv;
  }

  async ensureCacheLoaded(): Promise<void> {
    // Nothing to preload: the environment is read on every call.
  }

  async handleRotationEvent(): Promise<void> {
    // No external cache: derived keys are recomputed from the master key.
  }

  private readFileValue(key: string): string | undefined {
    const fileVariable = `${key}_FILE`;
    const filePath = process.env[fileVariable];
    if (filePath === undefined || filePath === '') {
      return undefined;
    }
    const cached = this.fileCache.get(fileVariable);
    if (cached !== undefined) {
      return cached;
    }
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      // Never include the file's content in the message.
      throw new Error(
        `${fileVariable} points to a file that cannot be read: ${filePath}`,
      );
    }
    const value = content.replace(/\s+$/, '');
    this.fileCache.set(fileVariable, value);
    return value;
  }

  private masterKey(): Buffer {
    if (this.masterKeyBytes !== null) {
      return this.masterKeyBytes;
    }
    this.masterKeyBytes = decodeMasterKey(this.rawMasterKey());
    return this.masterKeyBytes;
  }

  /** CYBEDEFEND_SECRET_KEY, else the content of CYBEDEFEND_SECRET_KEY_FILE; undefined when neither is set. */
  private rawMasterKey(): string | undefined {
    const fromEnv = process.env[MASTER_KEY_VARIABLE];
    if (fromEnv !== undefined && fromEnv !== '') {
      return fromEnv;
    }
    const fromFile = this.readFileValue(MASTER_KEY_VARIABLE);
    return fromFile !== undefined && fromFile.trim() !== ''
      ? fromFile
      : undefined;
  }
}
