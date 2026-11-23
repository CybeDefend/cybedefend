import {
  HttpException,
  HttpStatus,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Observable, of, throwError } from 'rxjs';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthModule } from './local-auth.module';
import { LocalAuthRateLimitGuard } from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { LoginAccountLimiter } from './login-account-limiter';
import { buildLoginDeviceCookie } from './login-device-cookie';
import { LoginInFlightLimiter } from './login-in-flight-limiter';
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
const ROTATED = { ...SESSION, accessToken: 'a2', refreshToken: 'r2' };
const SECURE = { path: '/auth', secure: true };
// Refresh and logout take the request only from the instance's own origin in
// the Community edition (local-auth.origin.spec.ts): every request here comes
// from FRONTEND_URL, as the dashboard's does.
const INSTANCE_ORIGIN = 'https://cd.example.test';

const grpcError = (code: number, details: string) =>
  throwError(() =>
    Object.assign(new Error(`${code} X: ${details}`), { code, details }),
  );

type Fake = Record<string, jest.Mock<Observable<unknown>>>;

/** The per-account limiter, observed: what the login route reports. */
function fakeLimiter() {
  const attempt = {
    succeeded: jest.fn(async () => undefined),
    refund: jest.fn(async () => undefined),
  };
  return {
    attempt,
    reserve: jest.fn(
      async (_email: string, _reply?: unknown, _client?: unknown) => attempt,
    ),
    trust: jest.fn(async () => undefined),
  };
}
let limiter: ReturnType<typeof fakeLimiter>;

/** The per-address concurrency bound, observed. */
function fakeInFlight() {
  const release = jest.fn(async () => undefined);
  return {
    release,
    acquire: jest.fn(async (_address: string, _reply?: unknown) => release),
  };
}
let inFlight: ReturnType<typeof fakeInFlight>;

const DEVICE = 'D'.repeat(43);
/** The Set-Cookie values of an answer, as a list. */
const cookiesOf = (res: { headers: Record<string, unknown> }): string[] => {
  const raw = res.headers['set-cookie'];
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
};

function fakeClient(): Fake {
  return {
    getSetupStatus: jest.fn(() =>
      of({
        setupOpen: true,
        signupMode: 'invite_only',
        passwordResetByEmail: false,
      }),
    ),
    setupInstance: jest.fn(() =>
      of({ session: SESSION, organizationId: 'o1', teamId: 't1' }),
    ),
    signUp: jest.fn(() => of({ session: SESSION })),
    login: jest.fn(() => of({ session: SESSION })),
    refresh: jest.fn(() => of({ session: ROTATED })),
    logout: jest.fn(() => of({})),
    getJwks: jest.fn(() => of({ keys: [] })),
  };
}

async function makeApp(client: Fake, env: Record<string, unknown> = {}) {
  const moduleRef = await Test.createTestingModule({
    controllers: [LocalAuthController],
    providers: [
      LocalAuthService,
      { provide: LoginAccountLimiter, useValue: limiter },
      { provide: LoginInFlightLimiter, useValue: inFlight },
      {
        provide: ConfigService,
        useValue: new ConfigService({ FRONTEND_URL: INSTANCE_ORIGIN, ...env }),
      },
      {
        provide: 'GLOBAL_MANAGEMENT_SERVICE',
        useValue: { getService: () => client },
      },
    ],
  })
    .overrideGuard(LocalAuthRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();
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

const LOGIN = { email: 'user@x.io', password: 'correct horse battery' };
const SETUP = {
  setupToken: 'setup-token-value',
  email: 'admin@x.io',
  name: 'Admin',
  password: 'correct horse battery',
  organizationName: 'Acme',
};
const SIGNUP = {
  email: 'new@x.io',
  name: 'New',
  password: 'correct horse battery',
};

describe('LocalAuthController', () => {
  let app: NestFastifyApplication;
  let client: Fake;
  const logSpies: jest.SpyInstance[] = [];

  const inject = (opts: {
    method: 'GET' | 'POST';
    url: string;
    payload?: object;
    cookie?: string;
  }) =>
    app.inject({
      method: opts.method,
      url: opts.url,
      payload: opts.payload,
      headers: {
        origin: INSTANCE_ORIGIN,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
    });

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    for (const level of ['warn', 'error'] as const) {
      logSpies.push(
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
      );
    }
    client = fakeClient();
    limiter = fakeLimiter();
    inFlight = fakeInFlight();
    app = await makeApp(client);
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
    for (const spy of logSpies.splice(0)) spy.mockRestore();
  });

  it('reports the setup status', async () => {
    const res = await inject({ method: 'GET', url: '/auth/setup' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      setupOpen: true,
      signupMode: 'invite_only',
      passwordResetByEmail: false,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 503 AUTH_UNAVAILABLE when global-management is unreachable', async () => {
    client.getSetupStatus.mockImplementation(() =>
      grpcError(GrpcStatus.UNAVAILABLE, 'No connection established'),
    );
    const res = await inject({ method: 'GET', url: '/auth/setup' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      code: 'AUTH_UNAVAILABLE',
      message: 'AUTH_UNAVAILABLE',
    });
    expect(res.body).not.toContain('No connection');
  });

  it('sets the refresh cookie and returns the access token on login', async () => {
    const res = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: LOGIN,
    });
    expect(res.statusCode).toBe(200);
    expect(cookiesOf(res)).toContain(
      buildRefreshCookie('r1', NOW + 30 * 86_400_000, SECURE, NOW),
    );
    expect(res.json()).toEqual({
      accessToken: 'a',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(client.login).toHaveBeenCalledWith({
      email: 'user@x.io',
      password: LOGIN.password,
      clientIp: '127.0.0.1',
    });
  });

  describe('per-account login limit', () => {
    it('reserves an attempt for the account, then reports a success', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
      });
      expect(res.statusCode).toBe(200);
      expect(limiter.reserve).toHaveBeenCalledTimes(1);
      expect(limiter.reserve.mock.calls[0][0]).toBe('user@x.io');
      expect(limiter.attempt.succeeded).toHaveBeenCalledTimes(1);
      expect(limiter.attempt.refund).not.toHaveBeenCalled();
    });

    it('keeps a wrong password counted, for a known and an unknown e-mail alike', async () => {
      client.login.mockImplementation(() =>
        grpcError(GrpcStatus.UNAUTHENTICATED, 'INVALID_CREDENTIALS'),
      );
      for (const email of ['user@x.io', 'nobody@x.io']) {
        const res = await inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'wrong-password!' },
        });
        expect(res.statusCode).toBe(401);
      }
      expect(limiter.reserve).toHaveBeenCalledTimes(2);
      expect(limiter.attempt.succeeded).not.toHaveBeenCalled();
      expect(limiter.attempt.refund).not.toHaveBeenCalled();
    });

    it('gives the attempt back when global-management is unavailable', async () => {
      client.login.mockImplementation(() =>
        grpcError(GrpcStatus.UNAVAILABLE, 'PASSWORD_VERIFICATION_BUSY'),
      );
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
      });
      expect(res.statusCode).toBe(503);
      expect(limiter.attempt.refund).toHaveBeenCalledTimes(1);
      expect(limiter.attempt.succeeded).not.toHaveBeenCalled();
    });

    it('answers 429 RATE_LIMITED without calling global-management on a locked account', async () => {
      limiter.reserve.mockImplementation(async (_email, reply) => {
        (reply as { header: (n: string, v: string) => void }).header(
          'Retry-After',
          '300',
        );
        throw new HttpException(
          { message: 'RATE_LIMITED', code: 'RATE_LIMITED', retryAfter: 300 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      });
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
      });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('300');
      expect(res.json()).toMatchObject({
        code: 'RATE_LIMITED',
        message: 'RATE_LIMITED',
      });
      expect(client.login).not.toHaveBeenCalled();
    });

    it('names the client to the limiter by its login device only, never its address', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
        remoteAddress: '2001:db8:1:2::7',
        headers: { cookie: `cd_login_device=${DEVICE}` },
      });
      expect(limiter.reserve.mock.calls[0][2]).toEqual({
        deviceToken: DEVICE,
      });
    });

    it('keeps the browser as a login device after a success: a new token, then the same one', async () => {
      const first = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
      });
      const issued = cookiesOf(first).find((c) =>
        c.startsWith('cd_login_device='),
      );
      expect(issued).toBeDefined();
      const token = /^cd_login_device=([^;]+);/.exec(issued!)![1];
      expect(issued).toBe(buildLoginDeviceCookie(token, SECURE));
      expect(limiter.reserve.mock.calls[0][2]).toMatchObject({
        deviceToken: token,
      });

      const again = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
        cookie: `cd_login_device=${DEVICE}`,
      });
      expect(cookiesOf(again)).toContain(
        buildLoginDeviceCookie(DEVICE, SECURE),
      );
    });

    it('sets no device cookie on a failed login', async () => {
      client.login.mockImplementation(() =>
        grpcError(GrpcStatus.UNAUTHENTICATED, 'INVALID_CREDENTIALS'),
      );
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
      });
      expect(res.statusCode).toBe(401);
      expect(cookiesOf(res)).toEqual([]);
    });

    it('holds one concurrency slot of the /64 for the login, released whatever the outcome', async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
        remoteAddress: '::ffff:192.0.2.4',
      });
      expect(inFlight.acquire.mock.calls[0][0]).toBe('192.0.2.4');
      expect(inFlight.release).toHaveBeenCalledTimes(1);

      client.login.mockImplementation(() =>
        grpcError(GrpcStatus.UNAUTHENTICATED, 'INVALID_CREDENTIALS'),
      );
      await inject({ method: 'POST', url: '/auth/login', payload: LOGIN });
      expect(inFlight.release).toHaveBeenCalledTimes(2);
    });

    it('answers the concurrency 429 without counting the account or calling global-management', async () => {
      inFlight.acquire.mockImplementation(async () => {
        throw new HttpException(
          { message: 'RATE_LIMITED', code: 'RATE_LIMITED', retryAfter: 1 },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      });
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: LOGIN,
      });
      expect(res.statusCode).toBe(429);
      expect(limiter.reserve).not.toHaveBeenCalled();
      expect(client.login).not.toHaveBeenCalled();
    });

    it('does not count a body the validation pipe refuses', async () => {
      const res = await inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'not-an-email', password: 'x' },
      });
      expect(res.statusCode).toBe(400);
      expect(limiter.reserve).not.toHaveBeenCalled();
    });
  });

  it('answers 401 INVALID_CREDENTIALS the same way for an unknown e-mail and a wrong password', async () => {
    const bodies: unknown[] = [];
    for (const details of ['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS']) {
      client.login.mockImplementationOnce(() =>
        grpcError(GrpcStatus.UNAUTHENTICATED, details),
      );
    }
    for (const payload of [
      { email: 'nobody@x.io', password: 'whatever-password' },
      { email: 'user@x.io', password: 'wrong-password!' },
    ]) {
      const res = await inject({ method: 'POST', url: '/auth/login', payload });
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
      const body = res.json();
      delete body.timestamp;
      bodies.push(body);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'INVALID_CREDENTIALS',
    });
  });

  it('rotates the cookie on refresh', async () => {
    const res = await inject({
      method: 'POST',
      url: '/auth/refresh',
      cookie: 'other=1; cd_refresh=r1',
    });
    expect(res.statusCode).toBe(200);
    expect(client.refresh).toHaveBeenCalledWith({ refreshToken: 'r1' });
    expect(res.headers['set-cookie']).toBe(
      buildRefreshCookie('r2', NOW + 30 * 86_400_000, SECURE, NOW),
    );
    expect(res.json()).toEqual({
      accessToken: 'a2',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 409 and leaves the cookie on a refresh race', async () => {
    client.refresh.mockImplementation(() =>
      grpcError(GrpcStatus.ABORTED, 'REFRESH_RACE'),
    );
    const res = await inject({
      method: 'POST',
      url: '/auth/refresh',
      cookie: 'cd_refresh=r1',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'REFRESH_RACE' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('clears the cookie on an invalid refresh token', async () => {
    client.refresh.mockImplementation(() =>
      grpcError(GrpcStatus.UNAUTHENTICATED, 'REFRESH_INVALID'),
    );
    const res = await inject({
      method: 'POST',
      url: '/auth/refresh',
      cookie: 'cd_refresh=r1',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'REFRESH_INVALID' });
    expect(res.headers['set-cookie']).toBe(
      'cd_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('keeps the cookie when global-management is unreachable on refresh', async () => {
    client.refresh.mockImplementation(() =>
      grpcError(GrpcStatus.UNAVAILABLE, 'down'),
    );
    const res = await inject({
      method: 'POST',
      url: '/auth/refresh',
      cookie: 'cd_refresh=r1',
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 401 and clears the cookie when the refresh cookie is missing', async () => {
    const res = await inject({ method: 'POST', url: '/auth/refresh' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      code: 'REFRESH_INVALID',
      message: 'REFRESH_INVALID',
    });
    expect(res.headers['set-cookie']).toBe(
      'cd_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('logs out with 204 and clears the cookie even when global-management fails', async () => {
    client.logout.mockImplementation(() =>
      grpcError(GrpcStatus.UNAVAILABLE, 'down'),
    );
    const res = await inject({
      method: 'POST',
      url: '/auth/logout',
      cookie: 'cd_refresh=r1',
    });
    expect(res.statusCode).toBe(204);
    expect(client.logout).toHaveBeenCalledWith({ refreshToken: 'r1' });
    expect(res.headers['set-cookie']).toBe(
      'cd_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    // Logged by gRPC code only, never the token.
    const logged = JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain('r1');
  });

  it('logs out with 204 and calls nothing without a cookie', async () => {
    const res = await inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(client.logout).not.toHaveBeenCalled();
    expect(res.headers['set-cookie']).toBe(
      'cd_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict',
    );
  });

  it('returns the organization and team on setup', async () => {
    const res = await inject({
      method: 'POST',
      url: '/auth/setup',
      payload: SETUP,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      accessToken: 'a',
      tokenType: 'Bearer',
      expiresIn: 900,
      organizationId: 'o1',
      teamId: 't1',
    });
    expect(res.headers['set-cookie']).toBe(
      buildRefreshCookie('r1', NOW + 30 * 86_400_000, SECURE, NOW),
    );
    expect(client.setupInstance).toHaveBeenCalledWith({
      ...SETUP,
      clientIp: '127.0.0.1',
    });
  });

  it('passes a short password to global-management and answers its 400 PASSWORD_POLICY', async () => {
    client.setupInstance.mockImplementation(() =>
      grpcError(GrpcStatus.INVALID_ARGUMENT, 'PASSWORD_POLICY'),
    );
    const res = await inject({
      method: 'POST',
      url: '/auth/setup',
      payload: { ...SETUP, password: '12345678901' },
    });
    expect(client.setupInstance).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'PASSWORD_POLICY' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    ['SETUP_CLOSED', GrpcStatus.FAILED_PRECONDITION, HttpStatus.CONFLICT],
    ['SETUP_TOKEN_INVALID', GrpcStatus.PERMISSION_DENIED, HttpStatus.FORBIDDEN],
  ])('maps %s on setup', async (code, grpc, http) => {
    client.setupInstance.mockImplementation(() => grpcError(grpc, code));
    const res = await inject({
      method: 'POST',
      url: '/auth/setup',
      payload: SETUP,
    });
    expect(res.statusCode).toBe(http);
    expect(res.json()).toMatchObject({ code, message: code });
  });

  it('refuses a setup body without a setup token, with no call', async () => {
    const body: Partial<typeof SETUP> = { ...SETUP };
    delete body.setupToken;
    const res = await inject({
      method: 'POST',
      url: '/auth/setup',
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBeUndefined();
    expect(client.setupInstance).not.toHaveBeenCalled();
  });

  it('signs up when global-management allows it', async () => {
    const res = await inject({
      method: 'POST',
      url: '/auth/signup',
      payload: SIGNUP,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      accessToken: 'a',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(res.headers['set-cookie']).toBe(
      buildRefreshCookie('r1', NOW + 30 * 86_400_000, SECURE, NOW),
    );
    expect(client.signUp).toHaveBeenCalledWith({
      ...SIGNUP,
      clientIp: '127.0.0.1',
    });
  });

  it.each([
    ['SIGNUP_DISABLED', GrpcStatus.FAILED_PRECONDITION, HttpStatus.FORBIDDEN],
    ['SETUP_REQUIRED', GrpcStatus.FAILED_PRECONDITION, HttpStatus.CONFLICT],
    ['ACCOUNT_EXISTS', GrpcStatus.ALREADY_EXISTS, HttpStatus.CONFLICT],
    ['PASSWORD_POLICY', GrpcStatus.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST],
  ])('maps %s on sign-up', async (code, grpc, http) => {
    client.signUp.mockImplementation(() => grpcError(grpc, code));
    const res = await inject({
      method: 'POST',
      url: '/auth/signup',
      payload: SIGNUP,
    });
    expect(res.statusCode).toBe(http);
    expect(res.json()).toMatchObject({ code, message: code });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('writes the configured cookie path', async () => {
    await app.close();
    app = await makeApp(client, { AUTH_COOKIE_PATH: '/api/auth' });
    const res = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: LOGIN,
    });
    for (const cookie of cookiesOf(res)) {
      expect(cookie).toMatch(
        /; Path=\/api\/auth; HttpOnly; Secure; SameSite=Strict$/,
      );
    }
  });

  it('never echoes the password or the token in an error body', async () => {
    client.login.mockImplementation(() =>
      grpcError(GrpcStatus.UNAUTHENTICATED, 'INVALID_CREDENTIALS'),
    );
    const login = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@x.io', password: 'S3cretPassw0rd!' },
    });
    expect(login.body).not.toContain('S3cretPassw0rd!');

    const tooLong = 'P'.repeat(1025);
    const dto = await inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@x.io', password: tooLong },
    });
    expect(dto.statusCode).toBe(400);
    expect(dto.body).not.toContain(tooLong);

    client.refresh.mockImplementation(() =>
      grpcError(GrpcStatus.UNAUTHENTICATED, 'REFRESH_INVALID'),
    );
    const refresh = await inject({
      method: 'POST',
      url: '/auth/refresh',
      cookie: 'cd_refresh=refreshTokenValue123',
    });
    expect(refresh.body).not.toContain('refreshTokenValue123');

    client.setupInstance.mockImplementation(() =>
      grpcError(GrpcStatus.PERMISSION_DENIED, 'SETUP_TOKEN_INVALID'),
    );
    const setup = await inject({
      method: 'POST',
      url: '/auth/setup',
      payload: SETUP,
    });
    expect(setup.body).not.toContain(SETUP.setupToken);
    expect(setup.body).not.toContain(SETUP.password);
  });
});

describe('LocalAuthModule', () => {
  it('warns AUTH_COOKIE_INSECURE once at boot when the Secure flag is off', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    try {
      new LocalAuthModule(
        new ConfigService({ AUTH_COOKIE_INSECURE_LOCALHOST: true }),
      ).onModuleInit();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('AUTH_COOKIE_INSECURE');

      warn.mockClear();
      new LocalAuthModule(new ConfigService({})).onModuleInit();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
