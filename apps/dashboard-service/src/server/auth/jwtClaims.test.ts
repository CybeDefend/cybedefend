/**
 * jwtClaims — timing helpers used to schedule the proactive token refresh.
 * No signature verification here (the gateway does that); we only read `exp`
 * and `iat` to know WHEN to refresh.
 */
import { describe, it, expect } from 'vitest';
import {
  readTokenTiming,
  refreshMarginSeconds,
  computeRefreshDelayMs,
  secondsUntilExpiry,
} from './jwtClaims';

const b64url = (obj: object): string =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

export const makeJwt = (payload: object): string =>
  `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

describe('readTokenTiming', () => {
  it('reads exp and iat from the payload', () => {
    expect(readTokenTiming(makeJwt({ exp: 1000, iat: 400 }))).toEqual({ exp: 1000, iat: 400 });
  });

  it('returns null iat when absent', () => {
    expect(readTokenTiming(makeJwt({ exp: 1000 }))).toEqual({ exp: 1000, iat: null });
  });

  it('returns null for an undecodable or exp-less token', () => {
    expect(readTokenTiming('not-a-jwt')).toBeNull();
    expect(readTokenTiming(makeJwt({ sub: 'x' }))).toBeNull();
  });
});

describe('refreshMarginSeconds', () => {
  it('is 10% of the lifetime, clamped to [30, 120]', () => {
    expect(refreshMarginSeconds({ exp: 600, iat: 0 })).toBe(60);
    expect(refreshMarginSeconds({ exp: 100, iat: 0 })).toBe(30);
    expect(refreshMarginSeconds({ exp: 3600, iat: 0 })).toBe(120);
  });

  it('defaults to 60 s when iat is unknown', () => {
    expect(refreshMarginSeconds({ exp: 600, iat: null })).toBe(60);
  });
});

describe('computeRefreshDelayMs', () => {
  it('fires at exp - margin', () => {
    const now = 1_000_000_000;
    const token = makeJwt({ iat: now, exp: now + 600 });
    expect(computeRefreshDelayMs(token, now * 1000)).toBe(540_000);
  });

  it('never returns a negative delay', () => {
    const now = 1_000_000_000;
    const token = makeJwt({ iat: now - 700, exp: now - 100 });
    expect(computeRefreshDelayMs(token, now * 1000)).toBe(0);
  });

  it('returns null for an undecodable token', () => {
    expect(computeRefreshDelayMs('nope')).toBeNull();
  });
});

describe('secondsUntilExpiry', () => {
  it('returns the remaining seconds (negative when expired)', () => {
    const now = 1_000_000_000;
    expect(secondsUntilExpiry(makeJwt({ exp: now + 90 }), now * 1000)).toBe(90);
    expect(secondsUntilExpiry(makeJwt({ exp: now - 5 }), now * 1000)).toBe(-5);
    expect(secondsUntilExpiry('nope', now * 1000)).toBeNull();
  });
});
