import { createHmac } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import SecretsService from 'src/core/secrets/secrets.service';

/** The derived secret that keys the requester HMAC (secret-key.ts). */
export const RESET_REQUESTER_KEY_SECRET = 'AUTH_RESET_REQUESTER_HMAC_KEY';

/**
 * The key of the hourly password-reset cap per (requester, user): the
 * HMAC-SHA256 (hex) of the requester's address, trimmed and lower-cased (an
 * IPv6 address), keyed by AUTH_RESET_REQUESTER_HMAC_KEY. The Community secrets
 * source derives that key from CYBEDEFEND_SECRET_KEY under its own HKDF label
 * (`auth-reset-requester-hmac`). A plain SHA-256 of an IPv4 address is
 * reversed by trying the 2^32 addresses; without the instance's key the stored
 * value says nothing about the address, and two instances store different
 * values for one address. An absent address (an older gateway) has one key of
 * its own, i.e. the former per-user cap among such requests.
 *
 * Community-only by construction: LocalAuthModule, which provides it, is
 * loaded only when CYBEDEFEND_EDITION=community, so the cloud never needs the
 * key. The key is read in onModuleInit after `ensureCacheLoaded()`, never in
 * the constructor, and a missing or malformed key fails the boot, naming the
 * variable only.
 */
@Injectable()
export class ResetRequesterKeyer implements OnModuleInit {
  private key: Buffer | null = null;

  constructor(private readonly secrets: SecretsService) {}

  async onModuleInit(): Promise<void> {
    await this.secrets.ensureCacheLoaded();
    const raw = this.secrets.getSecret(RESET_REQUESTER_KEY_SECRET);
    const key =
      typeof raw === 'string' && /^[0-9a-fA-F]{64}$/.test(raw.trim())
        ? Buffer.from(raw.trim(), 'hex')
        : null;
    if (!key) {
      throw new Error(
        `${RESET_REQUESTER_KEY_SECRET} is missing or not 32 bytes (64 hex characters): set CYBEDEFEND_SECRET_KEY`,
      );
    }
    this.key = key;
  }

  /** The stored requester key of `address` (64 hex characters). */
  keyOf(address: string | undefined): string {
    if (!this.key) {
      throw new Error(`${RESET_REQUESTER_KEY_SECRET} is not loaded`);
    }
    const normalized = (address ?? '').trim().toLowerCase();
    return createHmac('sha256', this.key).update(normalized).digest('hex');
  }
}
