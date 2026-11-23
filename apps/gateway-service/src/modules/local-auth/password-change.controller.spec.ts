import { ValidationPipe, type Provider } from '@nestjs/common';
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
import { LocalAuthRateLimitGuard } from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { PasswordChangeController } from './password-change.controller';
import { buildRefreshCookie } from './refresh-cookie';

const NOW = 1_730_000_000_000;
const SESSION = {
  accessToken: 'a',
  // int64 fields reach the gateway as strings (longs: String).
  accessTokenExpiresAt: String(NOW + 900_000) as unknown as number,
  refreshToken: 'r1',
  refreshTokenExpiresAt: String(NOW + 30 * 86_400_000) as unknown as number,
  userId: 'u1',
  email: 'user@x.io',
  name: 'User',
};
const NEW_SESSION = { ...SESSION, accessToken: 'a2', refreshToken: 'r2' };
const SECURE = { path: '/auth', secure: true };

const JWT_USER: RequestUser = {
  sub: 'u1',
  email: 'user@x.io',
  name: 'User',
  via: 'jwt',
};
const PAT_USER: RequestUser = { ...JWT_USER, via: 'pat' };

const BODY = {
  currentPassword: 'old-password-1',
  newPassword: 'new-password-2',
};

const grpcError = (code: number, details: string) =>
  throwError(() =>
    Object.assign(new Error(`${code} X: ${details}`), { code, details }),
  );

type Fake = Record<string, jest.Mock<Observable<unknown>>>;

function fakeClient(): Fake {
  return {
    changePassword: jest.fn(() => of({ session: NEW_SESSION })),
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
    controllers: [PasswordChangeController],
    providers,
  });
  if (opts.realAuth) {
    // No guard override: the real CombinedAuthRateLimitGuard runs, with a
    // real AuthGuard on a FakeJwksSource, so a missing bearer is a 401.
    builder = Test.createTestingModule({
      controllers: [PasswordChangeController],
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
    })
      .overrideGuard(LocalAuthRateLimitGuard)
      .useValue({ canActivate: () => true });
  } else {
    builder = builder
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const req = context.switchToHttp().getRequest();
          req.user = opts.user ?? JWT_USER;
          return true;
        },
      })
      .overrideGuard(LocalAuthRateLimitGuard)
      .useValue({ canActivate: () => true });
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

describe('PasswordChangeController', () => {
  let app: NestFastifyApplication;
  let client: Fake;

  const inject = (opts: {
    payload?: object;
    cookie?: string;
    user?: RequestUser;
    realAuth?: boolean;
  }) =>
    app.inject({
      method: 'POST',
      url: '/auth/password/change',
      payload: opts.payload ?? BODY,
      headers: opts.cookie ? { cookie: opts.cookie } : {},
    });

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    client = fakeClient();
    app = await makeApp(client);
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('changes the password and sets the new cookie', async () => {
    const res = await inject({ cookie: 'other=1; cd_refresh=r1' });
    expect(res.statusCode).toBe(200);
    expect(client.changePassword).toHaveBeenCalledWith({
      userId: 'u1',
      currentPassword: BODY.currentPassword,
      newPassword: BODY.newPassword,
      refreshToken: 'r1',
    });
    expect(res.json()).toEqual({
      accessToken: 'a2',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(res.headers['set-cookie']).toBe(
      buildRefreshCookie('r2', NOW + 30 * 86_400_000, SECURE, NOW),
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends an absent cookie as an empty refresh token', async () => {
    const res = await inject({});
    expect(res.statusCode).toBe(200);
    expect(client.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: '' }),
    );
  });

  it('refuses a personal access token with 403 PAT_NOT_ALLOWED', async () => {
    await app.close();
    app = await makeApp(client, { user: PAT_USER });
    const res = await inject({ cookie: 'cd_refresh=r1' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: 'PAT_NOT_ALLOWED',
      message: 'PAT_NOT_ALLOWED',
    });
    expect(client.changePassword).not.toHaveBeenCalled();
  });

  it('maps CURRENT_PASSWORD_INVALID to 400, never 401', async () => {
    client.changePassword.mockImplementation(() =>
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'CURRENT_PASSWORD_INVALID'),
    );
    const res = await inject({ cookie: 'cd_refresh=r1' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      statusCode: 400,
      code: 'CURRENT_PASSWORD_INVALID',
      message: 'CURRENT_PASSWORD_INVALID',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('maps PASSWORD_POLICY to 400', async () => {
    client.changePassword.mockImplementation(() =>
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'PASSWORD_POLICY'),
    );
    const res = await inject({});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'PASSWORD_POLICY' });
  });

  it('answers 503 AUTH_UNAVAILABLE when global-management is down', async () => {
    client.changePassword.mockImplementation(() =>
      grpcError(GrpcStatus.UNAVAILABLE, 'down'),
    );
    const res = await inject({});
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'AUTH_UNAVAILABLE' });
    expect(res.body).not.toContain('down');
  });

  it('requires authentication', async () => {
    await app.close();
    app = await makeApp(client, { realAuth: true });
    const res = await inject({});
    expect(res.statusCode).toBe(401);
    expect(client.changePassword).not.toHaveBeenCalled();
  });
});
