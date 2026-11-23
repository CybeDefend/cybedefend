import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { Logger } from 'nestjs-pino';
import { from, Observable, of, throwError } from 'rxjs';
import {
  LOCAL_AUTH_SERVICE_NAME,
  type GetJwksRequest,
  type GetJwksResponse,
  type LocalJwk,
  type VerifyLocalPersonalAccessTokenRequest,
  type VerifyLocalPersonalAccessTokenResponse,
} from '@grpc/global-management/local_auth';
import {
  COMMUNITY_AUDIENCE,
  COMMUNITY_ISSUER,
  COMMUNITY_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS,
  COMMUNITY_JWKS_TTL_MS,
  LocalJwksSource,
} from './jwks-source.community';

/**
 * The Community Edition's JWKS_SOURCE. The local signing keys come
 * from global-management's `LocalAuthService.GetJwks`, cached 10 minutes with
 * at most one forced refresh per 30 s on an unknown `kid`, and a `cdp_`
 * bearer is verified with one `VerifyPersonalAccessToken` call per request,
 * no cache. global-management is not running in these specs: the gRPC client
 * is a fake, and the keys are real ES256 pairs so `jwtVerify` really verifies.
 */

interface TestKey {
  kid: string;
  jwk: LocalJwk;
  sign: () => Promise<string>;
}

const grpcError = (
  code: GrpcStatus,
  details: string,
): Error & { code: number; details: string } =>
  Object.assign(new Error(`${code} ${details}`), { code, details });

const makeLogger = () =>
  ({ error: jest.fn(), warn: jest.fn(), log: jest.fn() }) as unknown as Logger;

const makeKey = async (kid: string): Promise<TestKey> => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey);
  return {
    kid,
    jwk: {
      kid,
      kty: jwk.kty ?? 'EC',
      crv: jwk.crv ?? 'P-256',
      x: jwk.x ?? '',
      y: jwk.y ?? '',
      alg: 'ES256',
      use: 'sig',
    },
    sign: () =>
      new SignJWT({ cybeid: 'u1', email: 'a@b.c', name: 'A' })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(COMMUNITY_ISSUER)
        .setAudience(COMMUNITY_AUDIENCE)
        .sign(privateKey),
  };
};

type FakeLocalAuth = {
  getJwks: jest.MockedFunction<
    (request: GetJwksRequest) => Observable<GetJwksResponse>
  >;
  verifyPersonalAccessToken: jest.MockedFunction<
    (
      request: VerifyLocalPersonalAccessTokenRequest,
    ) => Observable<VerifyLocalPersonalAccessTokenResponse>
  >;
};

const makeSource = (localAuth: FakeLocalAuth, logger = makeLogger()) => {
  const client = {
    getService: jest.fn((_name: string) => localAuth),
  } as unknown as ClientGrpc & { getService: jest.Mock };
  const source = new LocalJwksSource(client, logger);
  return { source, client, logger };
};

describe('LocalJwksSource — community JWKS and cdp_ personal access tokens', () => {
  let k1: TestKey;
  let localAuth: FakeLocalAuth;

  beforeEach(async () => {
    jest.useFakeTimers();
    k1 = await makeKey('k1');
    localAuth = {
      getJwks: jest.fn<Observable<GetJwksResponse>, [GetJwksRequest]>(),
      verifyPersonalAccessToken: jest.fn<
        Observable<VerifyLocalPersonalAccessTokenResponse>,
        [VerifyLocalPersonalAccessTokenRequest]
      >(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Boots the source with `getJwks` answering `keys` on every call. */
  const boot = async (keys: LocalJwk[]) => {
    localAuth.getJwks.mockReturnValue(of({ keys }));
    const made = makeSource(localAuth);
    await made.source.init();
    return made;
  };

  /**
   * Asserts an unknown-kid verification is refused. jose codes the rejection
   * ERR_JWKS_NO_MATCHING_KEY; under ts-jest's transpile of jose the error
   * class itself cannot be constructed (its field initializer is emitted
   * before super), so there the same rejection arrives codeless. Either way
   * the kid is refused.
   */
  const expectUnknownKidRefused = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const code = (error as { code?: string }).code;
    if (code !== undefined) {
      expect(code).toBe('ERR_JWKS_NO_MATCHING_KEY');
    }
    return error;
  };

  it('expects the community issuer and audience', async () => {
    const { source, client } = await boot([k1.jwk]);

    expect(source.expectations()).toEqual({
      issuer: 'cybedefend-community',
      audience: 'cybedefend-api',
      // The local keys are ES256: no other algorithm is accepted.
      algorithms: ['ES256'],
    });
    expect(COMMUNITY_ISSUER).toBe('cybedefend-community');
    expect(COMMUNITY_AUDIENCE).toBe('cybedefend-api');
    expect(COMMUNITY_JWKS_TTL_MS).toBe(600_000);
    expect(COMMUNITY_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS).toBe(30_000);
    expect(client.getService).toHaveBeenCalledWith(LOCAL_AUTH_SERVICE_NAME);
  });

  it('reads the keys once and caches them 10 minutes', async () => {
    const { source } = await boot([k1.jwk]);
    expect(localAuth.getJwks).toHaveBeenCalledTimes(1);

    const token = await k1.sign();
    const resolver = source.keyResolver();
    await jwtVerify(token, resolver, source.expectations());

    jest.advanceTimersByTime(COMMUNITY_JWKS_TTL_MS - 1_000); // 599 s
    await jwtVerify(token, resolver, source.expectations());
    expect(localAuth.getJwks).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000); // 601 s
    await jwtVerify(token, resolver, source.expectations());
    expect(localAuth.getJwks).toHaveBeenCalledTimes(2);
  });

  it('refreshes once on an unknown kid', async () => {
    const k2 = await makeKey('k2');
    localAuth.getJwks
      .mockReturnValueOnce(of({ keys: [k1.jwk] }))
      .mockReturnValueOnce(of({ keys: [k1.jwk, k2.jwk] }));
    const { source } = makeSource(localAuth);
    await source.init();

    const token = await k2.sign();
    const { payload } = await jwtVerify(
      token,
      source.keyResolver(),
      source.expectations(),
    );

    expect(payload.cybeid).toBe('u1');
    expect(localAuth.getJwks).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown kid after its refresh', async () => {
    const k2 = await makeKey('k2');
    // Every answer keeps only k1: the forced refresh learns nothing new.
    localAuth.getJwks.mockReturnValue(of({ keys: [k1.jwk] }));
    const { source } = makeSource(localAuth);
    await source.init();

    const token = await k2.sign();
    await expectUnknownKidRefused(
      jwtVerify(token, source.keyResolver(), source.expectations()),
    );
    expect(localAuth.getJwks).toHaveBeenCalledTimes(2);
  });

  it('forces at most one refresh per 30 s', async () => {
    const k2 = await makeKey('k2');
    const k3 = await makeKey('k3');
    localAuth.getJwks
      .mockReturnValueOnce(of({ keys: [k1.jwk] }))
      .mockReturnValueOnce(of({ keys: [k1.jwk, k2.jwk] }))
      .mockReturnValue(of({ keys: [k1.jwk, k2.jwk, k3.jwk] }));
    const { source } = makeSource(localAuth);
    await source.init();

    // First unknown kid: one forced refresh (boot + this = 2 calls).
    await jwtVerify(
      await k2.sign(),
      source.keyResolver(),
      source.expectations(),
    );
    expect(localAuth.getJwks).toHaveBeenCalledTimes(2);

    // 10 s later, another unknown kid: throttled, no refresh, still rejected.
    jest.advanceTimersByTime(10_000);
    await expectUnknownKidRefused(
      jwtVerify(await k3.sign(), source.keyResolver(), source.expectations()),
    );
    expect(localAuth.getJwks).toHaveBeenCalledTimes(2);

    // 31 s after the forced refresh, an unknown kid forces again.
    jest.advanceTimersByTime(21_000);
    await jwtVerify(
      await k3.sign(),
      source.keyResolver(),
      source.expectations(),
    );
    expect(localAuth.getJwks).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight refresh between concurrent requests', async () => {
    const k2 = await makeKey('k2');
    let release!: (value: GetJwksResponse) => void;
    const gate = new Promise<GetJwksResponse>((resolve) => {
      release = resolve;
    });
    localAuth.getJwks
      .mockReturnValueOnce(of({ keys: [k1.jwk] }))
      .mockReturnValueOnce(from(gate));
    const { source } = makeSource(localAuth);
    await source.init();

    const resolver = source.keyResolver();
    const token = await k2.sign();
    const expectations = source.expectations();
    const calls = Array.from({ length: 5 }, () =>
      jwtVerify(token, resolver, expectations),
    );
    // Let every caller reach the in-flight refresh before releasing it.
    for (let i = 0; i < 100; i += 1) {
      await Promise.resolve();
    }
    release({ keys: [k1.jwk, k2.jwk] });

    await expect(Promise.all(calls)).resolves.toHaveLength(5);
    expect(localAuth.getJwks).toHaveBeenCalledTimes(2);
  });

  it('boots when global-management is down, and logs the failure once', async () => {
    localAuth.getJwks.mockReturnValue(
      throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'connect refused')),
    );
    const { source, logger } = makeSource(localAuth);

    await expect(source.init()).resolves.toBeUndefined();
    await expect(source.init()).resolves.toBeUndefined();
    expect(
      (logger as unknown as { error: jest.Mock }).error,
    ).toHaveBeenCalledTimes(1);
  });

  it('verifies a cdp_ token with one call per request, no cache', async () => {
    const { source } = await boot([k1.jwk]);
    localAuth.verifyPersonalAccessToken.mockReturnValue(
      of<VerifyLocalPersonalAccessTokenResponse>({
        userId: 'u1',
        email: 'a@b.c',
        name: 'A',
        tokenId: 't1',
      }),
    );

    const token = `cdp_${'a'.repeat(43)}`;
    const expected = { sub: 'u1', email: 'a@b.c', name: 'A' };
    await expect(source.verifyPersonalAccessToken(token)).resolves.toEqual(
      expected,
    );
    await expect(source.verifyPersonalAccessToken(token)).resolves.toEqual(
      expected,
    );

    expect(localAuth.verifyPersonalAccessToken).toHaveBeenCalledTimes(2);
    expect(localAuth.verifyPersonalAccessToken).toHaveBeenCalledWith({ token });
  });

  it('refuses an unknown personal access token', async () => {
    const { source } = await boot([k1.jwk]);
    localAuth.verifyPersonalAccessToken.mockReturnValue(
      throwError(() => grpcError(GrpcStatus.UNAUTHENTICATED, 'PAT_INVALID')),
    );

    const error = await source
      .verifyPersonalAccessToken(`cdp_${'b'.repeat(43)}`)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as Error).message).toBe('Invalid token');
  });

  it('answers 503 when global-management cannot verify the token', async () => {
    const { source } = await boot([k1.jwk]);
    localAuth.verifyPersonalAccessToken.mockReturnValue(
      throwError(() => grpcError(GrpcStatus.UNAVAILABLE, 'connect refused')),
    );

    const error = await source
      .verifyPersonalAccessToken(`cdp_${'c'.repeat(43)}`)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toBe('auth_unavailable');
  });

  it('returns null for a token that is not a cdp_ token', async () => {
    const { source } = await boot([k1.jwk]);

    await expect(
      source.verifyPersonalAccessToken('eyJhbGciOiJFUzI1NiJ9.abc.def'),
    ).resolves.toBeNull();
    expect(localAuth.verifyPersonalAccessToken).not.toHaveBeenCalled();
  });
});
