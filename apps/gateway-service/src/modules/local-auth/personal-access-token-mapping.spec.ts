import { HttpException, HttpStatus } from '@nestjs/common';
import type {
  CreateLocalPersonalAccessTokenResponse,
  LocalPersonalAccessToken,
} from '@grpc/global-management/local_auth';
import {
  isoToMs,
  msToIsoOrNull,
  toCreatedPersonalAccessToken,
  toPersonalAccessTokenItem,
} from './personal-access-token-mapping';

// int64 fields reach the gateway as strings (longs: String): feed strings.
const asInt64 = (ms: string | number) => ms as unknown as number;

const META: LocalPersonalAccessToken = {
  id: 'tok-1',
  name: 'ci',
  lastFour: 'a1b2',
  createdAt: asInt64('1730000000000'),
  lastUsedAt: asInt64('0'),
  expiresAt: asInt64(0),
};

describe('msToIsoOrNull', () => {
  it('converts int64 strings to ISO dates and 0 to null', () => {
    expect(msToIsoOrNull('1730000000000')).toBe('2024-10-27T03:33:20.000Z');
    expect(msToIsoOrNull(1730000000000)).toBe('2024-10-27T03:33:20.000Z');
    expect(msToIsoOrNull('0')).toBeNull();
    expect(msToIsoOrNull(0)).toBeNull();
    expect(msToIsoOrNull('')).toBeNull();
    expect(msToIsoOrNull(undefined)).toBeNull();
  });
});

describe('isoToMs', () => {
  it('sends an absent expiry as 0 and an ISO expiry as milliseconds', () => {
    expect(isoToMs(undefined)).toBe(0);
    expect(isoToMs('2030-01-01T00:00:00.000Z')).toBe(1893456000000);
  });

  // An expiry the gateway cannot read must never become 0, which
  // global-management stores as « never expires ».
  it.each([
    '20300101',
    '2030W011',
    '2030-W01-1',
    '20300101T000000Z',
    '1969-12-31T00:00:00Z',
    '0000-01-01',
  ])(
    'refuses %s as PAT_EXPIRY_INVALID instead of a token that never expires',
    (iso) => {
      let thrown: unknown;
      try {
        isoToMs(iso);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(
        HttpStatus.BAD_REQUEST,
      );
      expect((thrown as HttpException).getResponse()).toEqual({
        message: 'PAT_EXPIRY_INVALID',
        code: 'PAT_EXPIRY_INVALID',
      });
    },
  );
});

describe('toPersonalAccessTokenItem', () => {
  it('converts int64 strings to ISO dates and 0 to null, and carries no secret', () => {
    expect(toPersonalAccessTokenItem(META)).toEqual({
      id: 'tok-1',
      name: 'ci',
      lastFour: 'a1b2',
      createdAt: '2024-10-27T03:33:20.000Z',
      lastUsedAt: null,
      expiresAt: null,
    });
  });

  it('keeps a real lastUsedAt and expiresAt as ISO strings', () => {
    const item = toPersonalAccessTokenItem({
      ...META,
      lastUsedAt: asInt64('1730000000000'),
      expiresAt: asInt64('1893456000000'),
    });
    expect(item.lastUsedAt).toBe('2024-10-27T03:33:20.000Z');
    expect(item.expiresAt).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('toCreatedPersonalAccessToken', () => {
  it('answers the secret as token, a cdp_ string', () => {
    const response: CreateLocalPersonalAccessTokenResponse = {
      token: META,
      value: 'cdp_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
    };
    const result = toCreatedPersonalAccessToken(response);
    expect(result.token).toBe(response.value);
    expect(result.token.startsWith('cdp_')).toBe(true);
    expect(result).toEqual({
      id: 'tok-1',
      name: 'ci',
      lastFour: 'a1b2',
      createdAt: '2024-10-27T03:33:20.000Z',
      expiresAt: null,
      token: response.value,
    });
    // No key holds the metadata object: the secret and the metadata are
    // never swapped.
    for (const value of Object.values(result)) {
      expect(value).not.toBe(META);
      expect(typeof value === 'string' || value === null).toBe(true);
    }
  });
});
