import { HttpStatus, ValidationPipe, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { Observable, of, throwError } from 'rxjs';
import { AuthGuard } from 'src/core/guards/auth/auth.guard';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { RateLimitGuard } from 'src/core/guards/throttler/throttler.guard';
import { FakeJwksSource } from 'src/core/guards/auth/testing/jwks-source.testing';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import {
  JWKS_SOURCE,
  type RequestUser,
} from 'src/edition/ports/jwks-source.port';
import { LocalAuthService } from './local-auth.service';
import { PersonalAccessTokensController } from './personal-access-tokens.controller';

// int64 fields reach the gateway as strings (longs: String).
const asInt64 = (ms: string | number) => ms as unknown as number;

const JWT_USER: RequestUser = {
  sub: 'u1',
  email: 'user@x.io',
  name: 'User',
  via: 'jwt',
};
const PAT_USER: RequestUser = { ...JWT_USER, via: 'pat' };

const TOKEN_A = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'older',
  lastFour: 'aaaa',
  createdAt: asInt64('1730000000000'),
  lastUsedAt: asInt64('0'),
  expiresAt: asInt64(0),
};
const TOKEN_B = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'newer',
  lastFour: 'bbbb',
  createdAt: asInt64('1730000001000'),
  lastUsedAt: asInt64('1730000002000'),
  expiresAt: asInt64('1893456000000'),
};
const SECRET = 'cdp_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const TOKEN_ID = '22222222-2222-4222-8222-222222222222';

const grpcError = (code: number, details: string) =>
  throwError(() =>
    Object.assign(new Error(`${code} X: ${details}`), { code, details }),
  );

type Fake = Record<string, jest.Mock<Observable<unknown>>>;

function fakeClient(): Fake {
  return {
    listPersonalAccessTokens: jest.fn(() => of({ tokens: [TOKEN_A, TOKEN_B] })),
    createPersonalAccessToken: jest.fn(() =>
      of({ token: TOKEN_B, value: SECRET }),
    ),
    revokePersonalAccessToken: jest.fn(() => of({})),
  };
}

async function makeApp(
  client: Fake,
  opts: { user?: RequestUser; realAuth?: boolean } = {},
) {
  const providers: Provider[] = [
    LocalAuthService,
    { provide: ConfigService, useValue: new ConfigService({}) },
    {
      provide: 'GLOBAL_MANAGEMENT_SERVICE',
      useValue: { getService: () => client },
    },
  ];
  let builder = Test.createTestingModule({
    controllers: [PersonalAccessTokensController],
    providers,
  });
  if (opts.realAuth) {
    // No guard override: the real CombinedAuthRateLimitGuard runs, with a
    // real AuthGuard on a FakeJwksSource, so a missing bearer is a 401.
    builder = Test.createTestingModule({
      controllers: [PersonalAccessTokensController],
      providers: [
        ...providers,
        AuthGuard,
        RateLimitGuard,
        CombinedAuthRateLimitGuard,
        { provide: JWKS_SOURCE, useClass: FakeJwksSource },
        {
          provide: Logger,
          useValue: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        },
        { provide: 'REDIS_CLIENT', useValue: {} },
      ],
    });
  } else {
    builder = builder.overrideGuard(CombinedAuthRateLimitGuard).useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => Record<string, unknown> };
      }) => {
        const req = context.switchToHttp().getRequest();
        req.user = opts.user ?? JWT_USER;
        return true;
      },
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  // Verbatim copies of main.ts.
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('PersonalAccessTokensController', () => {
  let app: NestFastifyApplication;
  let client: Fake;

  beforeEach(async () => {
    client = fakeClient();
    app = await makeApp(client);
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('lists under tokens without the secret, newest first, dates ISO or null', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/personal-access-tokens',
    });
    expect(res.statusCode).toBe(200);
    expect(client.listPersonalAccessTokens).toHaveBeenCalledWith({
      userId: 'u1',
    });
    const body = res.json();
    expect(Object.keys(body)).toEqual(['tokens']);
    expect(body.tokens).toHaveLength(2);
    // Newest first.
    expect(body.tokens[0].id).toBe(TOKEN_B.id);
    expect(body.tokens[1].id).toBe(TOKEN_A.id);
    for (const item of body.tokens) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'expiresAt',
        'id',
        'lastFour',
        'lastUsedAt',
        'name',
      ]);
      expect(item).not.toHaveProperty('token');
      expect(item).not.toHaveProperty('value');
    }
    expect(body.tokens[0]).toEqual({
      id: TOKEN_B.id,
      name: 'newer',
      lastFour: 'bbbb',
      createdAt: '2024-10-27T03:33:21.000Z',
      lastUsedAt: '2024-10-27T03:33:22.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(body.tokens[1].lastUsedAt).toBeNull();
    expect(body.tokens[1].expiresAt).toBeNull();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toContain(SECRET);
  });

  it('creates a token for the caller and shows the secret once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/personal-access-tokens',
      payload: { name: 'ci', expiresAt: '2030-01-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(201);
    // The user is req.user.sub, never the body; the ISO expiry becomes ms.
    expect(client.createPersonalAccessToken).toHaveBeenCalledWith({
      userId: 'u1',
      name: 'ci',
      expiresAt: 1893456000000,
    });
    const body = res.json();
    expect(body.token).toBe(SECRET);
    expect(body.token.startsWith('cdp_')).toBe(true);
    expect(body).toEqual({
      id: TOKEN_B.id,
      name: 'newer',
      lastFour: 'bbbb',
      createdAt: '2024-10-27T03:33:21.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
      token: SECRET,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends an absent expiry as 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/personal-access-tokens',
      payload: { name: 'ci' },
    });
    expect(res.statusCode).toBe(201);
    expect(client.createPersonalAccessToken).toHaveBeenCalledWith({
      userId: 'u1',
      name: 'ci',
      expiresAt: 0,
    });
  });

  it('refuses an ISO basic-format expiry with 400 PAT_EXPIRY_INVALID, never a token that never expires', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/personal-access-tokens',
      payload: { name: 'ci', expiresAt: '20300101' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'PAT_EXPIRY_INVALID' });
    expect(client.createPersonalAccessToken).not.toHaveBeenCalled();
  });

  it('never reads the user from the body', async () => {
    await app.inject({
      method: 'POST',
      url: '/me/personal-access-tokens',
      payload: { name: 'ci', userId: 'someone-else' },
    });
    expect(client.createPersonalAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
  });

  it('revokes with 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/personal-access-tokens/${TOKEN_ID}`,
    });
    expect(res.statusCode).toBe(204);
    expect(client.revokePersonalAccessToken).toHaveBeenCalledWith({
      userId: 'u1',
      tokenId: TOKEN_ID,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // ParseUUIDPipe checks the version and variant digits: an id shaped like a
  // UUID but not one (no version 1-8, no variant 8-B) is refused before the
  // service is asked.
  it('refuses with 400 an id shaped like a UUID that is not one', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/me/personal-access-tokens/22222222-2222-2222-2222-222222222222',
    });
    expect(res.statusCode).toBe(400);
    expect(client.revokePersonalAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/me/personal-access-tokens', undefined],
    ['POST', '/me/personal-access-tokens', { name: 'ci' }],
    ['DELETE', `/me/personal-access-tokens/${TOKEN_ID}`, undefined],
  ])(
    'refuses a personal access token on %s with 403 PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
    async (method, url, payload) => {
      await app.close();
      client = fakeClient();
      app = await makeApp(client, { user: PAT_USER });
      const res = await app.inject({
        method: method as 'GET' | 'POST' | 'DELETE',
        url,
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        code: 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
        message: 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT',
      });
      expect(client.listPersonalAccessTokens).not.toHaveBeenCalled();
      expect(client.createPersonalAccessToken).not.toHaveBeenCalled();
      expect(client.revokePersonalAccessToken).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'PAT_NAME_INVALID',
      GrpcStatus.INVALID_ARGUMENT,
      HttpStatus.BAD_REQUEST,
      'createPersonalAccessToken',
    ],
    [
      'PAT_EXPIRY_INVALID',
      GrpcStatus.INVALID_ARGUMENT,
      HttpStatus.BAD_REQUEST,
      'createPersonalAccessToken',
    ],
    [
      'PAT_NAME_TAKEN',
      GrpcStatus.ALREADY_EXISTS,
      HttpStatus.CONFLICT,
      'createPersonalAccessToken',
    ],
    [
      'PAT_LIMIT_REACHED',
      GrpcStatus.RESOURCE_EXHAUSTED,
      HttpStatus.CONFLICT,
      'createPersonalAccessToken',
    ],
    [
      'PAT_NOT_FOUND',
      GrpcStatus.NOT_FOUND,
      HttpStatus.NOT_FOUND,
      'revokePersonalAccessToken',
    ],
  ])('maps %s to %s', async (code, grpc, http, method) => {
    client[method].mockImplementation(() => grpcError(grpc, code));
    const res =
      method === 'revokePersonalAccessToken'
        ? await app.inject({
            method: 'DELETE',
            url: `/me/personal-access-tokens/${TOKEN_ID}`,
          })
        : await app.inject({
            method: 'POST',
            url: '/me/personal-access-tokens',
            payload: { name: 'ci' },
          });
    expect(res.statusCode).toBe(http);
    expect(res.json()).toMatchObject({ code, message: code });
  });

  it('requires authentication', async () => {
    await app.close();
    app = await makeApp(client, { realAuth: true });
    const list = await app.inject({
      method: 'GET',
      url: '/me/personal-access-tokens',
    });
    expect(list.statusCode).toBe(401);
    const create = await app.inject({
      method: 'POST',
      url: '/me/personal-access-tokens',
      payload: { name: 'ci' },
    });
    expect(create.statusCode).toBe(401);
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/me/personal-access-tokens/${TOKEN_ID}`,
    });
    expect(revoke.statusCode).toBe(401);
    expect(client.listPersonalAccessTokens).not.toHaveBeenCalled();
    expect(client.createPersonalAccessToken).not.toHaveBeenCalled();
    expect(client.revokePersonalAccessToken).not.toHaveBeenCalled();
  });
});
