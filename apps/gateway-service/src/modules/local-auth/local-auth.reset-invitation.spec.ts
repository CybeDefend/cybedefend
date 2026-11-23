import { HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
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
import { redactUrlSecrets } from 'src/core/utils/redact-url-secrets.util';
import { LocalAuthController } from './local-auth.controller';
import {
  AUTH_RATE_LIMIT_KIND,
  LocalAuthRateLimitGuard,
} from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { LoginAccountLimiter } from './login-account-limiter';
import { LoginInFlightLimiter } from './login-in-flight-limiter';
import { buildLoginDeviceCookie } from './login-device-cookie';
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
const SECURE = { path: '/auth', secure: true };
const TRUST = jest.fn(async (_email: string, _client: unknown) => undefined);
const DEVICE = 'D'.repeat(43);

// A 64-hex-character invitation token (INVITATION_TOKEN_PATTERN), clearly a
// fixture: one repeated pair, so no secret scanner takes it for a real token.
const INVITE_TOKEN = 'ab'.repeat(32);

const grpcError = (code: number, details: string) =>
  throwError(() =>
    Object.assign(new Error(`${code} X: ${details}`), { code, details }),
  );

type Fake = Record<string, jest.Mock<Observable<unknown>>>;

function fakeClient(): Fake {
  return {
    requestPasswordReset: jest.fn(() => of({})),
    resetPassword: jest.fn(() => of({ email: 'ada@example.test' })),
    acceptInvitation: jest.fn(() =>
      of({ session: SESSION, organizationId: 'o1' }),
    ),
  };
}

async function makeApp(client: Fake) {
  const moduleRef = await Test.createTestingModule({
    controllers: [LocalAuthController],
    providers: [
      LocalAuthService,
      {
        // The per-account login limit has its own spec.
        provide: LoginAccountLimiter,
        useValue: {
          reserve: async () => ({
            succeeded: async () => undefined,
            refund: async () => undefined,
          }),
          trust: TRUST,
        },
      },
      {
        provide: LoginInFlightLimiter,
        useValue: { acquire: async () => async () => undefined },
      },
      { provide: ConfigService, useValue: new ConfigService({}) },
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

describe('LocalAuthController password reset and invitations', () => {
  let app: NestFastifyApplication;
  let client: Fake;
  const logSpies: jest.SpyInstance[] = [];

  const post = (url: string, payload?: object) =>
    app.inject({ method: 'POST', url, payload });

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    for (const level of ['warn', 'error'] as const) {
      logSpies.push(
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
      );
    }
    client = fakeClient();
    app = await makeApp(client);
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
    for (const spy of logSpies.splice(0)) spy.mockRestore();
  });

  describe('POST /auth/password-reset/request', () => {
    it('answers 202 the same way for a known and an unknown e-mail', async () => {
      const first = await post('/auth/password-reset/request', {
        email: 'known@x.io',
      });
      const second = await post('/auth/password-reset/request', {
        email: 'nobody@x.io',
      });
      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);
      expect(first.json()).toEqual({});
      expect(second.json()).toEqual({});
      expect(first.headers['cache-control']).toBe('no-store');
      expect(client.requestPasswordReset).toHaveBeenNthCalledWith(1, {
        email: 'known@x.io',
        clientIp: '127.0.0.1',
      });
      expect(client.requestPasswordReset).toHaveBeenNthCalledWith(2, {
        email: 'nobody@x.io',
        clientIp: '127.0.0.1',
      });
    });

    it("sends global-management the requester's /64, the key of its hourly cap", async () => {
      await app.inject({
        method: 'POST',
        url: '/auth/password-reset/request',
        payload: { email: 'ada@example.test' },
        remoteAddress: '2001:db8:4:4:9::1',
      });
      expect(client.requestPasswordReset).toHaveBeenCalledWith({
        email: 'ada@example.test',
        clientIp: '2001:db8:4:4::/64',
      });
    });

    it('still answers 202 and logs only the code when global-management fails with another error', async () => {
      client.requestPasswordReset.mockImplementation(() =>
        grpcError(GrpcStatus.INTERNAL, 'the server secret text'),
      );
      const res = await post('/auth/password-reset/request', {
        email: 'known@x.io',
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({});
      const logged = JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
      expect(logged).toContain(String(GrpcStatus.INTERNAL));
      expect(logged).not.toContain('the server secret text');
    });

    it('answers 503 AUTH_UNAVAILABLE when global-management is unavailable on a reset request', async () => {
      client.requestPasswordReset.mockImplementation(() =>
        grpcError(GrpcStatus.UNAVAILABLE, 'No connection established'),
      );
      const res = await post('/auth/password-reset/request', {
        email: 'known@x.io',
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        code: 'AUTH_UNAVAILABLE',
        message: 'AUTH_UNAVAILABLE',
      });
      expect(res.body).not.toContain('No connection');
    });

    it('refuses a body without an e-mail, with no call', async () => {
      const res = await post('/auth/password-reset/request', {});
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBeUndefined();
      expect(client.requestPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    it('confirms a reset with 204', async () => {
      const res = await post('/auth/password-reset/confirm', {
        token: 'reset-token-value',
        newPassword: 'new-password-2',
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(client.resetPassword).toHaveBeenCalledWith({
        token: 'reset-token-value',
        newPassword: 'new-password-2',
      });
    });

    it('clears the login counter of the account and keeps the browser as its login device', async () => {
      TRUST.mockClear();
      const res = await app.inject({
        method: 'POST',
        url: '/auth/password-reset/confirm',
        payload: { token: 'reset-token-value', newPassword: 'new-password-2' },
        remoteAddress: '2001:db8:4:4::1',
        headers: { cookie: `cd_login_device=${DEVICE}` },
      });
      expect(res.statusCode).toBe(204);
      expect(TRUST).toHaveBeenCalledWith('ada@example.test', {
        deviceToken: DEVICE,
      });
      expect(res.headers['set-cookie']).toBe(
        buildLoginDeviceCookie(DEVICE, SECURE),
      );
      // The e-mail is for the gateway only.
      expect(res.body).toBe('');
    });

    it('trusts nothing when the reset is refused', async () => {
      TRUST.mockClear();
      client.resetPassword.mockImplementation(() =>
        grpcError(GrpcStatus.INVALID_ARGUMENT, 'RESET_TOKEN_INVALID'),
      );
      const res = await post('/auth/password-reset/confirm', {
        token: 'reset-token-value',
        newPassword: 'new-password-2',
      });
      expect(res.statusCode).toBe(400);
      expect(TRUST).not.toHaveBeenCalled();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it.each([
      [
        'RESET_TOKEN_INVALID',
        GrpcStatus.INVALID_ARGUMENT,
        HttpStatus.BAD_REQUEST,
      ],
      ['PASSWORD_POLICY', GrpcStatus.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST],
    ])('maps %s to %s', async (code, grpc, http) => {
      client.resetPassword.mockImplementation(() => grpcError(grpc, code));
      const res = await post('/auth/password-reset/confirm', {
        token: 'reset-token-value',
        newPassword: 'short',
      });
      expect(res.statusCode).toBe(http);
      expect(res.json()).toMatchObject({ code, message: code });
    });
  });

  describe('POST /auth/invitations/:token/accept', () => {
    const ACCEPT = { name: 'Grace Hopper', password: 'correct horse battery' };

    it('accepts an invitation, sets the refresh cookie and returns the organization', async () => {
      const res = await post(
        `/auth/invitations/${INVITE_TOKEN}/accept`,
        ACCEPT,
      );
      expect(res.statusCode).toBe(200);
      expect(client.acceptInvitation).toHaveBeenCalledWith({
        token: INVITE_TOKEN,
        name: ACCEPT.name,
        password: ACCEPT.password,
      });
      expect(res.json()).toEqual({
        accessToken: 'a',
        tokenType: 'Bearer',
        expiresIn: 900,
        organizationId: 'o1',
      });
      expect(res.headers['set-cookie']).toBe(
        buildRefreshCookie('r1', NOW + 30 * 86_400_000, SECURE, NOW),
      );
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it.each([
      [
        'INVITATION_INVALID',
        GrpcStatus.INVALID_ARGUMENT,
        HttpStatus.BAD_REQUEST,
      ],
      ['ACCOUNT_EXISTS', GrpcStatus.ALREADY_EXISTS, HttpStatus.CONFLICT],
      ['PASSWORD_POLICY', GrpcStatus.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST],
    ])('maps %s', async (code, grpc, http) => {
      client.acceptInvitation.mockImplementation(() => grpcError(grpc, code));
      const res = await post(
        `/auth/invitations/${INVITE_TOKEN}/accept`,
        ACCEPT,
      );
      expect(res.statusCode).toBe(http);
      expect(res.json()).toMatchObject({ code, message: code });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it.each([
      ['not-hex', 'not 64 hex characters'],
      [INVITE_TOKEN.slice(0, 63), '63 characters'],
      [INVITE_TOKEN.toUpperCase(), 'uppercase hex'],
    ])(
      'refuses an invitation token that is %s, with no call',
      async (token) => {
        const res = await post(`/auth/invitations/${token}/accept`, ACCEPT);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          code: 'INVITATION_INVALID',
          message: 'INVITATION_INVALID',
        });
        expect(client.acceptInvitation).not.toHaveBeenCalled();
      },
    );

    it('logs the invitation path without its token', () => {
      const redacted = redactUrlSecrets(
        `/auth/invitations/${INVITE_TOKEN}/accept`,
      );
      expect(redacted).not.toContain(INVITE_TOKEN);
      expect(redacted).not.toMatch(/[0-9a-f]{64}/);
    });
  });

  describe('POST /auth/invitations/accept (the token in the body)', () => {
    const ACCEPT = { name: 'Grace Hopper', password: 'correct horse battery' };

    it('accepts an invitation exactly as the path route does', async () => {
      const res = await post('/auth/invitations/accept', {
        token: INVITE_TOKEN,
        ...ACCEPT,
      });
      expect(res.statusCode).toBe(200);
      expect(client.acceptInvitation).toHaveBeenCalledWith({
        token: INVITE_TOKEN,
        name: ACCEPT.name,
        password: ACCEPT.password,
      });
      expect(res.json()).toEqual({
        accessToken: 'a',
        tokenType: 'Bearer',
        expiresIn: 900,
        organizationId: 'o1',
      });
      expect(res.headers['set-cookie']).toBe(
        buildRefreshCookie('r1', NOW + 30 * 86_400_000, SECURE, NOW),
      );
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it.each([
      [
        'INVITATION_INVALID',
        GrpcStatus.INVALID_ARGUMENT,
        HttpStatus.BAD_REQUEST,
      ],
      ['ACCOUNT_EXISTS', GrpcStatus.ALREADY_EXISTS, HttpStatus.CONFLICT],
      ['PASSWORD_POLICY', GrpcStatus.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST],
    ])('maps %s', async (code, grpc, http) => {
      client.acceptInvitation.mockImplementation(() => grpcError(grpc, code));
      const res = await post('/auth/invitations/accept', {
        token: INVITE_TOKEN,
        ...ACCEPT,
      });
      expect(res.statusCode).toBe(http);
      expect(res.json()).toMatchObject({ code, message: code });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it.each<[unknown, string]>([
      ['not-hex', 'not 64 hex characters'],
      [INVITE_TOKEN.slice(0, 63), '63 characters'],
      [INVITE_TOKEN.toUpperCase(), 'uppercase hex'],
      [`${INVITE_TOKEN}\n`, 'followed by a newline'],
      [123, 'a number'],
      [undefined, 'absent'],
    ])(
      'refuses an invitation token that is %p (%s), with no call',
      async (token: unknown) => {
        const res = await post('/auth/invitations/accept', {
          ...ACCEPT,
          ...(token === undefined ? {} : { token }),
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          code: 'INVITATION_INVALID',
          message: 'INVITATION_INVALID',
        });
        expect(client.acceptInvitation).not.toHaveBeenCalled();
      },
    );

    it('shares the path route rate limit (ip)', () => {
      const proto = LocalAuthController.prototype as unknown as Record<
        string,
        object
      >;
      const kindOf = (name: string) =>
        Reflect.getMetadata(AUTH_RATE_LIMIT_KIND, proto[name]);
      expect(kindOf('acceptInvitationByBody')).toBe('ip');
      expect(kindOf('acceptInvitation')).toBe('ip');
    });
  });
});
