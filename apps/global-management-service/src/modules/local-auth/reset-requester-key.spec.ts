import { createHmac } from 'node:crypto';
import type SecretsService from 'src/core/secrets/secrets.service';
import {
  RESET_REQUESTER_KEY_SECRET,
  ResetRequesterKeyer,
} from './reset-requester-key';

/**
 * The key of the hourly password-reset cap per (requester, user): an
 * HMAC-SHA256 of the requester's address keyed by AUTH_RESET_REQUESTER_HMAC_KEY
 * (derived from CYBEDEFEND_SECRET_KEY by the Community secrets source). A plain
 * SHA-256 of an IPv4 address is reversed by trying the 2^32 addresses; without
 * the instance's key the stored value reveals nothing.
 */
const KEY_A = 'ab'.repeat(32);
const KEY_B = 'cd'.repeat(32);

async function keyerWith(value: string | undefined) {
  const secrets = {
    ensureCacheLoaded: jest.fn(async () => undefined),
    getSecret: jest.fn((name: string) =>
      name === RESET_REQUESTER_KEY_SECRET ? value : undefined,
    ),
  };
  const keyer = new ResetRequesterKeyer(secrets as unknown as SecretsService);
  await keyer.onModuleInit();
  return { keyer, secrets };
}

describe('ResetRequesterKeyer', () => {
  it('reads AUTH_RESET_REQUESTER_HMAC_KEY once the secrets cache is loaded', async () => {
    const { secrets } = await keyerWith(KEY_A);
    expect(RESET_REQUESTER_KEY_SECRET).toBe('AUTH_RESET_REQUESTER_HMAC_KEY');
    expect(secrets.ensureCacheLoaded).toHaveBeenCalled();
    expect(secrets.ensureCacheLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      secrets.getSecret.mock.invocationCallOrder[0],
    );
  });

  it('stores the HMAC-SHA256 of the address with the derived key, never the address', async () => {
    const { keyer } = await keyerWith(KEY_A);
    const stored = keyer.keyOf('203.0.113.7');
    expect(stored).toBe(
      createHmac('sha256', Buffer.from(KEY_A, 'hex'))
        .update('203.0.113.7')
        .digest('hex'),
    );
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain('203.0.113.7');
    expect(stored).not.toContain('203');
  });

  it('gives two instances with different keys different stored values for one address', async () => {
    const a = (await keyerWith(KEY_A)).keyer.keyOf('203.0.113.7');
    const b = (await keyerWith(KEY_B)).keyer.keyOf('203.0.113.7');
    expect(a).not.toBe(b);
  });

  it('tells two addresses apart, folds case and spaces, and gives an absent address a key of its own', async () => {
    const { keyer } = await keyerWith(KEY_A);
    expect(keyer.keyOf('203.0.113.7')).not.toBe(keyer.keyOf('198.51.100.9'));
    expect(keyer.keyOf(' 2001:DB8::1 ')).toBe(keyer.keyOf('2001:db8::1'));
    expect(keyer.keyOf(undefined)).toBe(keyer.keyOf(''));
    expect(keyer.keyOf(undefined)).not.toBe(keyer.keyOf('203.0.113.7'));
  });

  it('refuses to start without a 32-byte key, naming the variable and never a value', async () => {
    await expect(keyerWith(undefined)).rejects.toThrow(
      'AUTH_RESET_REQUESTER_HMAC_KEY is missing or not 32 bytes',
    );
    await expect(keyerWith('ab'.repeat(16))).rejects.toThrow(
      'AUTH_RESET_REQUESTER_HMAC_KEY is missing or not 32 bytes',
    );
    await expect(
      keyerWith('not hex at all, but long enough to be 64 ch'),
    ).rejects.toThrow(/not 32 bytes/);
  });
});
