import { AuthGuard } from './auth.guard';
import { FakeJwksSource } from './testing/jwks-source.testing';
import { Logger } from 'nestjs-pino';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { trace, type Span } from '@opentelemetry/api';
import {
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';
import type { AuthenticatedUser } from 'src/edition/ports/jwks-source.port';

const ISSUER = 'https://issuer.test';
const AUDIENCE = 'audience.test';

const makeCtx = (headers: Record<string, any> = {}) => {
  const req: any = { headers };
  const res: any = {};
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => ({}),
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
};

/**
 * Builds the guard on a `FakeJwksSource` whose key resolver and expectations
 * come from a throwaway jose ES256 key pair, so the JWT path runs against
 * real jose, not a mock.
 */
const makeGuard = async (overrides?: {
  patUser?: AuthenticatedUser | null;
}) => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const source = new FakeJwksSource();
  const resolver = jest.fn(async () => publicKey);
  source.keyResolver = (): JWTVerifyGetKey => resolver;
  source.expectations = () => ({ issuer: ISSUER, audience: AUDIENCE });
  source.verifyPersonalAccessToken = jest
    .fn()
    .mockResolvedValue(overrides?.patUser ?? null);
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  } as any as Logger;

  const guard = new AuthGuard(source, logger);

  const sign = (
    claims: Record<string, unknown>,
    options: {
      key?: CryptoKey;
      issuer?: string;
      audience?: string;
      expiresAt?: number;
    } = {},
  ): Promise<string> =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setSubject('logto-id')
      .setIssuedAt()
      .setExpirationTime(
        options.expiresAt ?? Math.floor(Date.now() / 1000) + 600,
      )
      .sign(options.key ?? privateKey);

  return { guard, source, logger, resolver, sign };
};

describe('AuthGuard', () => {
  it('should be defined', async () => {
    const { guard } = await makeGuard();
    expect(guard).toBeDefined();
  });

  it('rejects when no token is provided', async () => {
    const { guard } = await makeGuard();
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts valid JWT', async () => {
    const { guard, sign } = await makeGuard();
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    const token = await sign(
      { cybeid: 'u1', email: 'test@example.com' },
      { expiresAt },
    );
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = (ctx.switchToHttp() as any).getRequest();
    expect(req.user).toEqual({
      sub: 'u1',
      email: 'test@example.com',
      name: undefined,
      picture: undefined,
      via: 'jwt',
      exp: expiresAt,
    });
  });

  it('puts the expiry of the JWT on the request, for the streams it opens', async () => {
    const { guard, sign } = await makeGuard();
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const token = await sign({ cybeid: 'u1' }, { expiresAt });
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);
    expect((ctx.switchToHttp() as any).getRequest().user.exp).toBe(expiresAt);
  });

  it('rejects expired JWT', async () => {
    const { guard, logger } = await makeGuard();
    // jose's own error classes do not survive this repo's ts-jest transform,
    // so the expired mapping is pinned the way the guard sees it: a
    // verification failure carrying jose's ERR_JWT_EXPIRED code.
    (guard as unknown as { verifyJwt: jest.Mock }).verifyJwt = jest
      .fn()
      .mockRejectedValue({ code: 'ERR_JWT_EXPIRED', message: 'expired' });
    await expect(
      guard.canActivate(makeCtx({ authorization: 'Bearer bad' })),
    ).rejects.toThrow('Token expired');
    await expect(
      guard.canActivate(makeCtx({ authorization: 'Bearer bad' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rejects invalid JWT', async () => {
    const { guard, sign, logger } = await makeGuard();
    const { privateKey: foreignKey } = await generateKeyPair('ES256');
    const token = await sign({ cybeid: 'u1' }, { key: foreignKey });
    const rejection = guard.canActivate(
      makeCtx({ authorization: `Bearer ${token}` }),
    );
    await expect(rejection).rejects.toThrow('Invalid token');
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('verifies with the source’s issuer and audience', async () => {
    const { guard, sign } = await makeGuard();
    const token = await sign({ cybeid: 'u1' }, { audience: 'other-audience' });
    const rejection = guard.canActivate(
      makeCtx({ authorization: `Bearer ${token}` }),
    );
    await expect(rejection).rejects.toThrow('Invalid token');
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects JWT missing cybeid claim', async () => {
    const { guard, sign, logger } = await makeGuard();
    const token = await sign({
      email: 'test@example.com',
      // no cybeid present
    });
    const rejection = guard.canActivate(
      makeCtx({ authorization: `Bearer ${token}` }),
    );
    await expect(rejection).rejects.toThrow(/cybeid/);
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rejects JWT with null cybeid claim', async () => {
    const { guard, sign } = await makeGuard();
    const token = await sign({ cybeid: null, email: 'test@example.com' });
    await expect(
      guard.canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects JWT with empty-string cybeid claim', async () => {
    const { guard, sign } = await makeGuard();
    const token = await sign({ cybeid: '', email: 'test@example.com' });
    await expect(
      guard.canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects JWT with non-string cybeid claim', async () => {
    const { guard, sign } = await makeGuard();
    const token = await sign({ cybeid: 12345, email: 'test@example.com' });
    await expect(
      guard.canActivate(makeCtx({ authorization: `Bearer ${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('falls through to JWT verification when the source does not verify personal access tokens', async () => {
    const { guard, source } = await makeGuard({ patUser: null });
    const rejection = guard.canActivate(
      makeCtx({ authorization: 'Bearer cdp_abc' }),
    );
    await expect(rejection).rejects.toThrow('Invalid token');
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    expect(source.verifyPersonalAccessToken).toHaveBeenCalledTimes(1);
    expect(source.verifyPersonalAccessToken).toHaveBeenCalledWith('cdp_abc');
  });

  it('takes a verified personal access token as the user', async () => {
    const { guard, resolver } = await makeGuard({
      patUser: { sub: 'u1', email: 'a@b.c', name: 'A' },
    });
    const ctx = makeCtx({ authorization: 'Bearer cdp_abc' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = (ctx.switchToHttp() as any).getRequest();
    expect(req.user).toEqual({
      sub: 'u1',
      email: 'a@b.c',
      name: 'A',
      picture: undefined,
      via: 'pat',
    });
    // No JWT verification happened for a verified PAT.
    expect(resolver).not.toHaveBeenCalled();
  });

  it('marks a JWT user via jwt', async () => {
    const { guard, sign } = await makeGuard();
    const token = await sign({ cybeid: 'u1' });
    const ctx = makeCtx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = (ctx.switchToHttp() as any).getRequest();
    expect(req.user.via).toBe('jwt');
  });

  it('calls init once per guard instance', async () => {
    const { guard, source } = await makeGuard();
    const initSpy = jest.spyOn(source, 'init');
    await guard.onModuleInit();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Rejections could only be told apart by the span status message, and a bare `UnauthorizedException()` reads
 * 'Unauthorized' whether the header is absent (a crawler) or carries a token
 * in the wrong form ('bearer x', 'Token x', 'Basic ...'). Each rejection now
 * names its reason on the active span; exceptions and messages are unchanged.
 */
describe('AuthGuard — auth.rejection_reason on the active span', () => {
  const setAttribute = jest.fn();

  const makeCtx = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
        getResponse: () => ({}),
      }),
    }) as unknown as ExecutionContext;

  const makeGuard = (verifyJwt?: jest.Mock) => {
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    const guard = new AuthGuard(
      new FakeJwksSource(),
      logger as unknown as Logger,
    );
    if (verifyJwt) {
      (guard as unknown as { verifyJwt: jest.Mock }).verifyJwt = verifyJwt;
    }
    return guard;
  };

  const reasons = () =>
    setAttribute.mock.calls
      .filter(([key]) => key === 'auth.rejection_reason')
      .map(([, value]) => value);

  beforeEach(() => {
    setAttribute.mockReset();
    jest
      .spyOn(trace, 'getActiveSpan')
      .mockReturnValue({ setAttribute } as unknown as Span);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['no Authorization header', {}],
    ['an empty Authorization header', { authorization: '' }],
  ])('missing_header for %s, still a bare 401', async (_label, headers) => {
    const guard = makeGuard();
    const rejection = guard.canActivate(makeCtx(headers));

    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(rejection).rejects.toThrow('Unauthorized');
    expect(reasons()).toEqual(['missing_header']);
  });

  it.each([
    'bearer lowercase-scheme',
    'Token abc',
    'Basic dXNlcjpwYXNz',
    'Bearer ',
    'Bearer',
  ])(
    'unsupported_scheme for "%s", still a bare 401 without verifying anything',
    async (authorization) => {
      const verifyJwt = jest.fn();
      const guard = makeGuard(verifyJwt);
      const rejection = guard.canActivate(makeCtx({ authorization }));

      await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(rejection).rejects.toThrow('Unauthorized');
      expect(verifyJwt).not.toHaveBeenCalled();
      expect(reasons()).toEqual(['unsupported_scheme']);
    },
  );

  it('expired for an expired JWT, message unchanged', async () => {
    const guard = makeGuard(
      jest.fn().mockRejectedValue({ code: 'ERR_JWT_EXPIRED' }),
    );
    const rejection = guard.canActivate(
      makeCtx({ authorization: 'Bearer old' }),
    );

    await expect(rejection).rejects.toThrow('Token expired');
    expect(reasons()).toEqual(['expired']);
  });

  it('invalid for a JWT that fails verification, message unchanged', async () => {
    const guard = makeGuard(
      jest
        .fn()
        .mockRejectedValue({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }),
    );
    const rejection = guard.canActivate(
      makeCtx({ authorization: 'Bearer forged' }),
    );

    await expect(rejection).rejects.toThrow('Invalid token');
    expect(reasons()).toEqual(['invalid']);
  });

  // The token was never judged: the key set could not be read. Counted
  // as `invalid`, an alert that leaves out the crawlers' invalid tokens would
  // hide an outage refusing every user.
  it.each([
    ['a JWKS timeout', { code: 'ERR_JWKS_TIMEOUT' }],
    ['a JWKS answer other than 200 or not JSON', { code: 'ERR_JOSE_GENERIC' }],
    ['a malformed key set', { code: 'ERR_JWKS_INVALID' }],
    ['a failed fetch', new TypeError('fetch failed')],
  ])('jwks_unavailable for %s, message unchanged', async (_label, failure) => {
    const guard = makeGuard(jest.fn().mockRejectedValue(failure));
    const rejection = guard.canActivate(
      makeCtx({ authorization: 'Bearer any' }),
    );

    await expect(rejection).rejects.toThrow('Invalid token');
    expect(reasons()).toEqual(['jwks_unavailable']);
  });

  it('invalid for a token signed by a key the set does not hold', async () => {
    const guard = makeGuard(
      jest.fn().mockRejectedValue({ code: 'ERR_JWKS_NO_MATCHING_KEY' }),
    );
    const rejection = guard.canActivate(
      makeCtx({ authorization: 'Bearer foreign-kid' }),
    );

    await expect(rejection).rejects.toThrow('Invalid token');
    expect(reasons()).toEqual(['invalid']);
  });

  it('missing_cybeid for a valid JWT without cybeid, message unchanged', async () => {
    const guard = makeGuard(jest.fn().mockResolvedValue({ sub: 'logto-id' }));
    const rejection = guard.canActivate(
      makeCtx({ authorization: 'Bearer unmapped' }),
    );

    await expect(rejection).rejects.toThrow(
      'Invalid token: missing cybeid claim',
    );
    expect(reasons()).toEqual(['missing_cybeid']);
  });

  it('sets no reason on an accepted request', async () => {
    const guard = makeGuard(
      jest.fn().mockResolvedValue({ sub: 'logto-id', cybeid: 'u1' }),
    );

    await expect(
      guard.canActivate(makeCtx({ authorization: 'Bearer good' })),
    ).resolves.toBe(true);
    expect(reasons()).toEqual([]);
  });
});
