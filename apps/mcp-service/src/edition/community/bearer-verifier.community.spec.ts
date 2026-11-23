import { createHash } from 'node:crypto';
import axios from 'axios';
import type { ConfigService } from '@nestjs/config';

import {
  COMMUNITY_TOKEN_PATTERN,
  NEGATIVE_TTL_MS,
  POSITIVE_TTL_MS,
  PersonalAccessTokenBearerVerifier,
} from './bearer-verifier.community';
import { BEARER_VERIFIER_COMMUNITY_BINDINGS } from './bearer-verifier.binding';
import { BEARER_VERIFIER } from '../ports/bearer-verifier.port';

/**
 * Community bearer: a CybeDefend personal access token (`cdp_` + 32 random
 * bytes in base64url). A malformed bearer is refused without a network call;
 * a well-formed one is checked once against the gateway, and the answer is
 * cached briefly so the calls of a session do not re-check it each time.
 */
describe('PersonalAccessTokenBearerVerifier', () => {
  const t = 'cdp_' + 'A'.repeat(43);
  const other = 'cdp_' + 'B'.repeat(43);
  const config = {
    get: (key: string) =>
      key === 'CYBEDEFEND_API_RESOURCE' ? 'http://gateway.test' : undefined,
  } as unknown as ConfigService;

  let get: jest.Mock;
  let createSpy: jest.SpyInstance;

  const answer = (status: number) => get.mockResolvedValue({ status });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    get = jest.fn();
    createSpy = jest
      .spyOn(axios, 'create')
      .mockReturnValue({ get } as unknown as ReturnType<typeof axios.create>);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const build = () => new PersonalAccessTokenBearerVerifier(config);

  it('targets the gateway named by CYBEDEFEND_API_RESOURCE', () => {
    build();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://gateway.test' }),
    );
  });

  it('accepts a token the gateway accepts, keyed by a hash of the token', async () => {
    answer(200);
    await expect(build().verify(t)).resolves.toEqual({
      userId:
        'pat:' + createHash('sha256').update(t).digest('hex').slice(0, 32),
      accessToken: t,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/user/profile', {
      headers: { Authorization: `Bearer ${t}` },
    });
  });

  it.each([401, 403])(
    'refuses a well-formed token the gateway answers %i to',
    async (status) => {
      answer(status);
      await expect(build().verify(t)).resolves.toBeNull();
    },
  );

  it.each([429, 500, 502, 503])(
    'throws, without caching, when the gateway answers %i',
    async (status) => {
      const verifier = build();
      answer(status);
      await expect(verifier.verify(t)).rejects.toThrow();
      answer(200);
      await expect(verifier.verify(t)).resolves.not.toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
    },
  );

  it('throws, without caching, when the gateway cannot be reached', async () => {
    const verifier = build();
    get.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );
    await expect(verifier.verify(t)).rejects.toThrow();
    answer(200);
    await expect(verifier.verify(t)).resolves.not.toBeNull();
  });

  it('reuses an accepted answer for its TTL, then checks again', async () => {
    const verifier = build();
    answer(200);
    await verifier.verify(t);
    jest.setSystemTime(Date.now() + POSITIVE_TTL_MS - 1);
    await expect(verifier.verify(t)).resolves.not.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 2);
    answer(401);
    await expect(verifier.verify(t)).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('reuses a refusal for its TTL, then checks again', async () => {
    const verifier = build();
    answer(401);
    await verifier.verify(t);
    jest.setSystemTime(Date.now() + NEGATIVE_TTL_MS - 1);
    await expect(verifier.verify(t)).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 2);
    answer(200);
    await expect(verifier.verify(t)).resolves.not.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps one answer per token', async () => {
    const verifier = build();
    get.mockImplementation((_url, { headers }) =>
      Promise.resolve({
        status: headers.Authorization === `Bearer ${t}` ? 200 : 401,
      }),
    );
    await expect(verifier.verify(t)).resolves.not.toBeNull();
    await expect(verifier.verify(other)).resolves.toBeNull();
    await expect(verifier.verify(t)).resolves.not.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('checks a token once when several requests carry it at the same time', async () => {
    const verifier = build();
    answer(200);
    const results = await Promise.all([
      verifier.verify(t),
      verifier.verify(t),
      verifier.verify(t),
    ]);
    expect(results.every((r) => r !== null)).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('bounds the cache: the oldest answer is dropped first', async () => {
    class Small extends PersonalAccessTokenBearerVerifier {
      protected readonly maxEntries = 2;
    }
    const verifier = new Small(config);
    answer(401);
    const tokens = ['C', 'D', 'E'].map((c) => 'cdp_' + c.repeat(43));
    for (const token of tokens) await verifier.verify(token);
    expect(get).toHaveBeenCalledTimes(3);
    await verifier.verify(tokens[2]);
    expect(get).toHaveBeenCalledTimes(3);
    await verifier.verify(tokens[0]);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('refuses a JWT, a short token, padding and a Logto pat_ token without a network call', async () => {
    const verifier = build();
    const refused = [
      'eyJ.a.b',
      'cdp_' + 'A'.repeat(42),
      'cdp_' + 'A'.repeat(42) + '=',
      'pat_' + 'A'.repeat(43),
      'cdp_' + 'A'.repeat(44),
      'cdp_' + 'A'.repeat(42) + '.',
      'CDP_' + 'A'.repeat(43),
      ' cdp_' + 'A'.repeat(43),
      'cdp_' + 'A'.repeat(43) + '\n',
      [
        Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url'),
        Buffer.from('{"sub":"user-1"}').toString('base64url'),
        'c2lnbmF0dXJl',
      ].join('.'),
      '',
    ];
    for (const token of refused) {
      await expect(verifier.verify(token)).resolves.toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('accepts every base64url character, - and _ included', async () => {
    answer(200);
    const mixed = 'cdp_' + 'aZ09-_'.repeat(7) + 'x';
    expect(mixed).toHaveLength(47);
    await expect(build().verify(mixed)).resolves.toMatchObject({
      accessToken: mixed,
    });
  });

  it('never puts the token in the userId', async () => {
    answer(200);
    const verifier = build();
    const random = 'cdp_' + 'q7Rw-_Zx9'.repeat(4) + 'abcdefg';
    expect(COMMUNITY_TOKEN_PATTERN.test(random)).toBe(true);
    for (const token of [t, random]) {
      const { userId } = await verifier.verify(token);
      expect(userId).not.toContain(token.slice(4));
      expect(userId).toMatch(/^pat:[0-9a-f]{32}$/);
    }
  });

  it('challenges without resource_metadata', () => {
    const verifier = build();
    expect(verifier.challenge('missing_bearer')).toBe('Bearer');
    expect(verifier.challenge('invalid_token')).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it('is the community binding of BEARER_VERIFIER', () => {
    expect(BEARER_VERIFIER_COMMUNITY_BINDINGS).toEqual([
      { provide: BEARER_VERIFIER, useClass: PersonalAccessTokenBearerVerifier },
    ]);
  });
});
