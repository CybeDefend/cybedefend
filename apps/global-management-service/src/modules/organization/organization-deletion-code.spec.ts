import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  ORGANIZATION_DELETION_CODE_LOCK_MS,
  ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS,
  ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY,
  ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR,
  ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS,
  ORGANIZATION_DELETION_CODE_TTL_MS,
  ORGANIZATION_DELETION_REFUSALS,
  deletionCodeMatches,
  generateDeletionCode,
  hashDeletionCode,
  isWellFormedDeletionCode,
  organizationDeletionRefusal,
} from './organization-deletion-code';

describe('organization deletion code: the configured limits', () => {
  it('pins the TTL, the limits and the lock', () => {
    expect(ORGANIZATION_DELETION_CODE_TTL_MS).toBe(600_000);
    expect(ORGANIZATION_DELETION_CODE_MAX_ATTEMPTS).toBe(5);
    expect(ORGANIZATION_DELETION_CODE_MAX_SENDS_PER_HOUR).toBe(3);
    expect(ORGANIZATION_DELETION_CODE_MIN_SEND_INTERVAL_MS).toBe(60_000);
    expect(ORGANIZATION_DELETION_CODE_MAX_FAILURES_PER_DAY).toBe(10);
    expect(ORGANIZATION_DELETION_CODE_LOCK_MS).toBe(86_400_000);
  });
});

describe('generateDeletionCode', () => {
  it('is always 6 digits, zero-padded', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateDeletionCode()).toMatch(/^\d{6}$/);
    }
  });

  it('pads a small draw to 6 digits', () => {
    const crypto = jest.requireActual('node:crypto');
    const spy = jest.spyOn(crypto, 'randomInt').mockReturnValue(42 as never);
    try {
      expect(generateDeletionCode()).toBe('000042');
      expect(spy).toHaveBeenCalledWith(0, 1_000_000);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isWellFormedDeletionCode', () => {
  it.each(['123456', '000000'])('accepts %s', (code) => {
    expect(isWellFormedDeletionCode(code)).toBe(true);
  });
  it.each([
    '',
    '12345',
    '1234567',
    '12345a',
    ' 123456',
    undefined,
    null,
    123456,
  ])('refuses %p', (code) => {
    expect(isWellFormedDeletionCode(code as unknown)).toBe(false);
  });
});

describe('hashDeletionCode / deletionCodeMatches', () => {
  it('never stores the code: the hash is not the code and carries no digit run of it', async () => {
    const { hash, salt } = await hashDeletionCode('123456');
    expect(hash).not.toContain('123456');
    expect(salt).not.toContain('123456');
    // scrypt keylen 32, salt 16 bytes, hex.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('two hashes of the same code differ (a random salt per code)', async () => {
    const a = await hashDeletionCode('123456');
    const b = await hashDeletionCode('123456');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('matches the code and only the code', async () => {
    const stored = await hashDeletionCode('123456');
    await expect(deletionCodeMatches('123456', stored)).resolves.toBe(true);
    await expect(deletionCodeMatches('123457', stored)).resolves.toBe(false);
    await expect(deletionCodeMatches('654321', stored)).resolves.toBe(false);
  });

  it('a stored value of the wrong length never matches (and never throws)', async () => {
    await expect(
      deletionCodeMatches('123456', { hash: 'abcd', salt: '00'.repeat(16) }),
    ).resolves.toBe(false);
  });
});

describe('organizationDeletionRefusal: a closed list, the code as the message', () => {
  const codeAndMessage = (e: RpcException) => {
    const err = e.getError() as { code: number; message: string };
    return [err.code, err.message];
  };

  it('lists exactly the five refusals', () => {
    expect([...ORGANIZATION_DELETION_REFUSALS]).toEqual([
      'NOT_ORGANIZATION_CREATOR',
      'DELETION_CODE_INVALID',
      'DELETION_CODE_ATTEMPTS_EXCEEDED',
      'DELETION_CODE_RATE_LIMITED',
      'DELETION_LOCKED',
    ]);
  });

  it('maps each refusal to its gRPC status', () => {
    expect(
      codeAndMessage(organizationDeletionRefusal('NOT_ORGANIZATION_CREATOR')),
    ).toEqual([status.PERMISSION_DENIED, 'NOT_ORGANIZATION_CREATOR']);
    expect(
      codeAndMessage(organizationDeletionRefusal('DELETION_CODE_INVALID')),
    ).toEqual([status.INVALID_ARGUMENT, 'DELETION_CODE_INVALID']);
    expect(
      codeAndMessage(
        organizationDeletionRefusal('DELETION_CODE_ATTEMPTS_EXCEEDED'),
      ),
    ).toEqual([status.FAILED_PRECONDITION, 'DELETION_CODE_ATTEMPTS_EXCEEDED']);
    expect(
      codeAndMessage(organizationDeletionRefusal('DELETION_CODE_RATE_LIMITED')),
    ).toEqual([status.RESOURCE_EXHAUSTED, 'DELETION_CODE_RATE_LIMITED']);
    expect(
      codeAndMessage(organizationDeletionRefusal('DELETION_LOCKED')),
    ).toEqual([status.RESOURCE_EXHAUSTED, 'DELETION_LOCKED']);
  });
});
