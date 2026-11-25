import 'reflect-metadata';
import { RpcException } from '@nestjs/microservices';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import type { Repository } from 'typeorm';
import type {
  AcceptLocalInvitationResponse,
  CreateLocalPersonalAccessTokenResponse,
  GetJwksResponse,
  ListLocalPersonalAccessTokensResponse,
  LocalAuthSession,
  LocalChangePasswordResponse,
  LocalLoginResponse,
  LocalLogoutResponse,
  LocalRefreshResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  RevokeLocalPersonalAccessTokenResponse,
  VerifyLocalPersonalAccessTokenResponse,
} from '@grpc/global-management/local_auth';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { User } from 'src/entities/user.entity';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';
import { LocalCredentialStore } from './local-credential.store';
import { PasswordResetService } from './password-reset.service';
import { SetupService } from './setup.service';
import {
  PAT_PATTERN,
  type LocalPat,
  PersonalAccessTokenStore,
} from './personal-access-token.store';

const SESSION: LocalAuthSession = {
  accessToken: 'the.jwt',
  accessTokenExpiresAt: 1_800_000_000_900_000,
  refreshToken: 'the-refresh-token',
  refreshTokenExpiresAt: 1_800_000_000_000_000,
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.test',
  name: 'Ada Lovelace',
};

/**
 * The gRPC edge of the Community Edition's local auth:
 * nine RPCs of `LocalAuthService`, each with an explicit `@GrpcMethod`,
 * each keeping the generated messages and wrapping the session as
 * `{ session }`. The PAT handlers keep the original wire shape: `value` is the
 * secret, `token` the metadata.
 */
describe('LocalAuthController', () => {
  const service = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    jwks: jest.fn(),
    changePassword: jest.fn(),
  };
  const pats = {
    create: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    verify: jest.fn(),
  };
  const users = { findOne: jest.fn() };
  const logger = createLoggerMock();
  // The setup/sign-up and password reset handlers.
  const setup = { status: jest.fn(), setup: jest.fn(), signUp: jest.fn() };
  const passwordReset = { request: jest.fn(), reset: jest.fn() };
  // The AcceptInvitation handler.
  const invitations = { accept: jest.fn() };
  // The password proof of CreatePersonalAccessToken.
  const credentials = { assertCurrentPassword: jest.fn() };
  const controller = new LocalAuthController(
    service as unknown as LocalAuthService,
    pats as unknown as PersonalAccessTokenStore,
    users as unknown as Repository<User>,
    logger as unknown as Logger,
    setup as unknown as SetupService,
    passwordReset as unknown as PasswordResetService,
    invitations as unknown as InvitationAcceptanceService,
    credentials as unknown as LocalCredentialStore,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serves the RPCs of LocalAuthService with an explicit @GrpcMethod each', () => {
    const handlers = [
      ['login', 'Login'],
      ['refresh', 'Refresh'],
      ['logout', 'Logout'],
      ['getJwks', 'GetJwks'],
      ['changePassword', 'ChangePassword'],
      ['acceptInvitation', 'AcceptInvitation'],
      ['createPersonalAccessToken', 'CreatePersonalAccessToken'],
      ['listPersonalAccessTokens', 'ListPersonalAccessTokens'],
      ['revokePersonalAccessToken', 'RevokePersonalAccessToken'],
      ['verifyPersonalAccessToken', 'VerifyPersonalAccessToken'],
      ['requestPasswordReset', 'RequestPasswordReset'],
      ['resetPassword', 'ResetPassword'],
    ] as const;
    for (const [method, rpc] of handlers) {
      const metadata = Reflect.getMetadata(
        PATTERN_METADATA,
        LocalAuthController.prototype[method],
      );
      expect(metadata).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'LocalAuthService', rpc }),
        ]),
      );
    }
  });

  it('login wraps the session and logs the client IP only', async () => {
    service.login.mockResolvedValue(SESSION);
    const response: LocalLoginResponse = await controller.login({
      email: 'ada@example.test',
      password: 'the password',
      clientIp: '203.0.113.7',
    });
    expect(response).toEqual({ session: SESSION });
    expect(service.login).toHaveBeenCalledWith(
      'ada@example.test',
      'the password',
    );
    const logged = [logger.debug, logger.log, logger.warn, logger.error]
      .flatMap((m) => m.mock.calls)
      .flat()
      .map(String);
    expect(logged.some((line) => line.includes('203.0.113.7'))).toBe(true);
    expect(logged.some((line) => line.includes('ada@example.test'))).toBe(
      false,
    );
    expect(logged.some((line) => line.includes('the password'))).toBe(false);
  });

  it('refresh wraps the rotated session', async () => {
    service.refresh.mockResolvedValue(SESSION);
    const response: LocalRefreshResponse = await controller.refresh({
      refreshToken: 'the-refresh-token',
    });
    expect(response).toEqual({ session: SESSION });
    expect(service.refresh).toHaveBeenCalledWith('the-refresh-token');
  });

  it('logout answers an empty response whatever the store did', async () => {
    service.logout.mockResolvedValue(undefined);
    const response: LocalLogoutResponse = await controller.logout({
      refreshToken: 'unknown-token',
    });
    expect(response).toEqual({});
    expect(service.logout).toHaveBeenCalledWith('unknown-token');
  });

  it('getJwks answers the keys', async () => {
    const keys = [
      {
        kid: 'k1',
        kty: 'EC',
        crv: 'P-256',
        x: 'eX',
        y: 'eY',
        alg: 'ES256',
        use: 'sig',
      },
    ];
    service.jwks.mockResolvedValue(keys);
    const response: GetJwksResponse = await controller.getJwks({});
    expect(response).toEqual({ keys });
    expect(service.jwks).toHaveBeenCalledWith();
  });

  it('changePassword wraps the new session', async () => {
    service.changePassword.mockResolvedValue(SESSION);
    const response: LocalChangePasswordResponse =
      await controller.changePassword({
        userId: SESSION.userId,
        currentPassword: 'the current password',
        newPassword: 'the new password',
        refreshToken: 'the-refresh-token',
      });
    expect(response).toEqual({ session: SESSION });
    expect(service.changePassword).toHaveBeenCalledWith(
      SESSION.userId,
      'the current password',
      'the new password',
    );
  });

  // ─── Password reset ─────────────────────────────────

  it('requestPasswordReset answers an empty response and logs the client IP only', async () => {
    passwordReset.request.mockResolvedValue(undefined);
    const response: RequestPasswordResetResponse =
      await controller.requestPasswordReset({
        email: 'ada@example.test',
        clientIp: '203.0.113.7',
      });
    expect(response).toEqual({});
    expect(passwordReset.request).toHaveBeenCalledWith(
      'ada@example.test',
      expect.any(Date),
      '203.0.113.7',
    );
    const logged = [logger.debug, logger.log, logger.warn, logger.error]
      .flatMap((m) => m.mock.calls)
      .flat()
      .map(String);
    expect(logged.some((line) => line.includes('203.0.113.7'))).toBe(true);
    // never the e-mail
    expect(logged.some((line) => line.includes('ada@example.test'))).toBe(
      false,
    );
  });

  it("resetPassword answers the account's e-mail and propagates RESET_TOKEN_INVALID", async () => {
    passwordReset.reset.mockResolvedValue({ email: 'ada@example.test' });
    const response: ResetPasswordResponse = await controller.resetPassword({
      token: 'the-reset-token',
      newPassword: 'a-brand-new-password-1',
    });
    expect(response).toEqual({ email: 'ada@example.test' });
    expect(passwordReset.reset).toHaveBeenCalledWith(
      'the-reset-token',
      'a-brand-new-password-1',
      expect.any(Date),
    );
    const logged = [logger.debug, logger.log, logger.warn, logger.error]
      .flatMap((m) => m.mock.calls)
      .flat()
      .map(String);
    // never the token
    expect(logged.some((line) => line.includes('the-reset-token'))).toBe(false);

    passwordReset.reset.mockRejectedValue(
      new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'RESET_TOKEN_INVALID',
      }),
    );
    const thrown = await controller
      .resetPassword({
        token: 'a-used-token',
        newPassword: 'a-brand-new-password-1',
      })
      .catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'RESET_TOKEN_INVALID',
    });
  });

  // ─── Invitations ─────────────────────────────────────

  it('acceptInvitation maps the request to accept and wraps the session and organizationId', async () => {
    const ORG_ID = '22222222-2222-4222-8222-222222222222';
    const token = 'a'.repeat(64);
    invitations.accept.mockResolvedValue({
      session: SESSION,
      organizationId: ORG_ID,
    });

    const response: AcceptLocalInvitationResponse =
      await controller.acceptInvitation({
        token,
        name: 'Ada Lovelace',
        password: 'the password',
      });

    expect(response).toEqual({ session: SESSION, organizationId: ORG_ID });
    expect(invitations.accept).toHaveBeenCalledWith(
      { token, password: 'the password', name: 'Ada Lovelace' },
      expect.any(Date),
    );
  });

  // ─── Personal access tokens ──────────────────────────

  const CREATED_AT = new Date('2026-11-03T10:00:00.000Z');
  const PAT_VALUE = 'cdp_' + 'aB3-'.repeat(10) + 'aB3'; // 47 chars, base64url

  function patOf(over: Partial<LocalPat> = {}): LocalPat {
    return {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'ci',
      lastFour: PAT_VALUE.slice(-4),
      createdAt: CREATED_AT,
      lastUsedAt: null,
      expiresAt: null,
      ...over,
    };
  }

  it('answers the secret as value and the metadata as token', async () => {
    pats.create.mockResolvedValue({ pat: patOf(), token: PAT_VALUE });
    credentials.assertCurrentPassword.mockResolvedValueOnce(
      'the-verified-hash',
    );

    const response: CreateLocalPersonalAccessTokenResponse =
      await controller.createPersonalAccessToken({
        userId: SESSION.userId,
        name: 'ci',
        expiresAt: 0,
        currentPassword: 'the account password',
      });

    expect(credentials.assertCurrentPassword).toHaveBeenCalledWith(
      SESSION.userId,
      'the account password',
    );
    expect(response.value).toBe(PAT_VALUE);
    expect(response.value).toMatch(PAT_PATTERN);
    expect(response.token).toEqual({
      id: patOf().id,
      name: 'ci',
      lastFour: PAT_VALUE.slice(-4),
      createdAt: CREATED_AT.getTime(),
      lastUsedAt: 0,
      expiresAt: 0,
    });
    expect(response.token?.lastFour).toBe(response.value.slice(-4));
    // The hash just verified travels to the store, which re-checks it under
    // the credential row's lock.
    expect(pats.create).toHaveBeenCalledWith(
      SESSION.userId,
      'ci',
      null,
      expect.any(Date),
      { verifiedPasswordHash: 'the-verified-hash' },
    );
  });

  it('refuses to create a token without the account password: CURRENT_PASSWORD_INVALID, nothing created', async () => {
    credentials.assertCurrentPassword.mockRejectedValue(
      new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'CURRENT_PASSWORD_INVALID',
      }),
    );

    for (const currentPassword of ['a wrong password', '', undefined]) {
      const thrown = await controller
        .createPersonalAccessToken({
          userId: SESSION.userId,
          name: 'ci',
          expiresAt: 0,
          currentPassword,
        })
        .catch((e: unknown) => e);
      expect((thrown as RpcException).getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'CURRENT_PASSWORD_INVALID',
      });
    }
    expect(credentials.assertCurrentPassword).toHaveBeenLastCalledWith(
      SESSION.userId,
      '',
    );
    expect(pats.create).not.toHaveBeenCalled();
    credentials.assertCurrentPassword.mockReset();
  });

  it('reads a string expiresAt: an epoch-ms instant, 0 as no expiry', async () => {
    pats.create.mockResolvedValue({ pat: patOf(), token: PAT_VALUE });

    await controller.createPersonalAccessToken({
      userId: SESSION.userId,
      name: 'ci',
      // int64 arrives as a string at runtime (longs: String)
      expiresAt: '1893456000000' as unknown as number,
      currentPassword: 'the account password',
    });
    expect(pats.create).toHaveBeenLastCalledWith(
      SESSION.userId,
      'ci',
      new Date(1893456000000),
      expect.any(Date),
      expect.anything(),
    );

    await controller.createPersonalAccessToken({
      userId: SESSION.userId,
      name: 'ci',
      expiresAt: '0' as unknown as number,
      currentPassword: 'the account password',
    });
    expect(pats.create).toHaveBeenLastCalledWith(
      SESSION.userId,
      'ci',
      null,
      expect.any(Date),
      expect.anything(),
    );
  });

  it('lists the active tokens as metadata only, never a value', async () => {
    pats.list.mockResolvedValue([
      patOf(),
      patOf({
        id: '88888888-8888-4888-8888-888888888888',
        name: 'deploy',
        lastUsedAt: new Date('2026-11-03T11:00:00.000Z'),
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ]);

    const response: ListLocalPersonalAccessTokensResponse =
      await controller.listPersonalAccessTokens({ userId: SESSION.userId });

    expect(response.tokens).toEqual([
      {
        id: patOf().id,
        name: 'ci',
        lastFour: PAT_VALUE.slice(-4),
        createdAt: CREATED_AT.getTime(),
        lastUsedAt: 0,
        expiresAt: 0,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'deploy',
        lastFour: PAT_VALUE.slice(-4),
        createdAt: CREATED_AT.getTime(),
        lastUsedAt: new Date('2026-11-03T11:00:00.000Z').getTime(),
        expiresAt: new Date('2027-01-01T00:00:00.000Z').getTime(),
      },
    ]);
    expect(pats.list).toHaveBeenCalledWith(SESSION.userId, expect.any(Date));
  });

  it('revoke answers an empty response and propagates PAT_NOT_FOUND', async () => {
    pats.revoke.mockResolvedValue(undefined);
    const response: RevokeLocalPersonalAccessTokenResponse =
      await controller.revokePersonalAccessToken({
        userId: SESSION.userId,
        tokenId: patOf().id,
      });
    expect(response).toEqual({});
    expect(pats.revoke).toHaveBeenCalledWith(
      SESSION.userId,
      patOf().id,
      expect.any(Date),
    );

    pats.revoke.mockRejectedValue(
      new RpcException({ code: status.NOT_FOUND, message: 'PAT_NOT_FOUND' }),
    );
    const thrown = await controller
      .revokePersonalAccessToken({
        userId: SESSION.userId,
        tokenId: '99999999-9999-4999-8999-999999999999',
      })
      .catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.NOT_FOUND,
      message: 'PAT_NOT_FOUND',
    });
  });

  it("verifies a token with the user's email and name", async () => {
    pats.verify.mockResolvedValue({
      userId: SESSION.userId,
      tokenId: patOf().id,
    });
    users.findOne.mockResolvedValue({
      id: SESSION.userId,
      email: 'ada@example.test',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    const response: VerifyLocalPersonalAccessTokenResponse =
      await controller.verifyPersonalAccessToken({ token: PAT_VALUE });

    expect(response).toEqual({
      userId: SESSION.userId,
      email: 'ada@example.test',
      name: 'Ada Lovelace',
      tokenId: patOf().id,
    });
    expect(pats.verify).toHaveBeenCalledWith(PAT_VALUE, expect.any(Date));
  });

  it('refuses an unknown, revoked or expired token with PAT_INVALID', async () => {
    pats.verify.mockResolvedValue(null);

    const thrown = await controller
      .verifyPersonalAccessToken({ token: PAT_VALUE })
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.UNAUTHENTICATED,
      message: 'PAT_INVALID',
    });
    expect(users.findOne).not.toHaveBeenCalled();
  });
});
