import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { generateKeyPairSync } from 'node:crypto';
import type { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import type { LocalAuthSession } from '@grpc/global-management/local_auth';
import { User } from 'src/entities/user.entity';
import {
  createLoggerMock,
  createMockRepository,
  type MockType,
} from 'src/test-utils/typeorm-mock.util';
import { AccessTokenIssuer } from './access-token.issuer';
import { LocalCredentialStore } from './local-credential.store';
import { LocalAuthService } from './local-auth.service';
import { localAuthRefusal } from './local-auth-refusals';
import { PasswordHasher } from './password-hasher';
import {
  REFRESH_FAMILY_TTL_MS,
  RefreshTokenStore,
} from './refresh-token.store';
import { SigningKeyService } from './signing-key.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '22222222-2222-4222-8222-222222222222';
const KID = 'test-kid';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
// A whole second, so the issuer's exp * 1000 is exactly now + 900_000.
const NOW = new Date('2026-11-03T10:00:00.000Z');
const REFRESH_TOKEN = 'the-refresh-token';
const REUSED_TOKEN = 'a-reused-refresh-token';

const ada = {
  id: USER_ID,
  email: 'ada@example.test',
  firstName: 'Ada Lovelace',
  lastName: '',
} as User;

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: status; message: string }> {
  const thrown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(RpcException);
  return (thrown as RpcException).getError() as {
    code: status;
    message: string;
  };
}

describe('LocalAuthService', () => {
  let service: LocalAuthService;
  let userRepo: MockType<Repository<User>>;
  let hasher: {
    verify: jest.Mock;
    verifyAgainstDummy: jest.Mock;
    hash: jest.Mock;
  };
  let credentials: { hashOf: jest.Mock; changePassword: jest.Mock };
  let signingKeys: { currentKey: jest.Mock; jwks: jest.Mock };
  let refreshTokens: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revokeFamilyOf: jest.Mock;
    revokeAllOfUser: jest.Mock;
  };
  let logger: ReturnType<typeof createLoggerMock>;

  beforeEach(async () => {
    userRepo = createMockRepository<User>();
    hasher = {
      verify: jest.fn(),
      verifyAgainstDummy: jest.fn(async () => false as const),
      hash: jest.fn(),
    };
    credentials = { hashOf: jest.fn(), changePassword: jest.fn() };
    const privateKey = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    }).privateKey;
    signingKeys = {
      currentKey: jest.fn(async () => ({ kid: KID, privateKey })),
      jwks: jest.fn(),
    };
    refreshTokens = {
      issue: jest.fn(async () => ({
        token: REFRESH_TOKEN,
        expiresAt: new Date(NOW.getTime() + REFRESH_FAMILY_TTL_MS),
      })),
      rotate: jest.fn(),
      revokeFamilyOf: jest.fn(async () => undefined),
      revokeAllOfUser: jest.fn(async () => undefined),
    };
    logger = createLoggerMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalAuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: PasswordHasher, useValue: hasher },
        { provide: LocalCredentialStore, useValue: credentials },
        { provide: SigningKeyService, useValue: signingKeys },
        AccessTokenIssuer,
        { provide: RefreshTokenStore, useValue: refreshTokens },
        { provide: Logger, useValue: logger },
      ],
    }).compile();
    service = module.get<LocalAuthService>(LocalAuthService);
  });

  function givenValidLogin(): void {
    userRepo.findOne!.mockResolvedValue(ada);
    credentials.hashOf.mockResolvedValue(HASH);
    hasher.verify.mockResolvedValue(true);
  }

  it('opens a session for the right password', async () => {
    givenValidLogin();
    const session = await service.login(
      'ada@example.test',
      'the right password',
      NOW,
    );
    expect(credentials.hashOf).toHaveBeenCalledWith(USER_ID);
    expect(hasher.verify).toHaveBeenCalledWith(HASH, 'the right password');
    expect(refreshTokens.issue).toHaveBeenCalledWith(USER_ID, NOW);
    expect(session.userId).toBe(USER_ID);
    expect(session.email).toBe('ada@example.test');
    expect(session.refreshToken).toBe(REFRESH_TOKEN);
    // A real ES256 JWT, signed with the current key.
    const [header, payload] = session.accessToken.split('.');
    expect(
      JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    ).toEqual({
      alg: 'ES256',
      typ: 'JWT',
      kid: KID,
    });
    expect(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    ).toMatchObject({
      iss: 'cybedefend-community',
      aud: 'cybedefend-api',
      sub: USER_ID,
      cybeid: USER_ID,
    });
  });

  it('answers INVALID_CREDENTIALS to a wrong password', async () => {
    givenValidLogin();
    hasher.verify.mockResolvedValue(false);
    const refusal = await refusalOf(
      service.login('ada@example.test', 'wrong password', NOW),
    );
    expect(refusal).toEqual({
      code: status.UNAUTHENTICATED,
      message: 'INVALID_CREDENTIALS',
    });
    expect(refreshTokens.issue).not.toHaveBeenCalled();
  });

  it('answers INVALID_CREDENTIALS to an unknown e-mail after one dummy verification', async () => {
    userRepo.findOne!.mockResolvedValue(null);
    const refusal = await refusalOf(
      service.login('nobody@example.test', 'whatever password', NOW),
    );
    expect(refusal).toEqual({
      code: status.UNAUTHENTICATED,
      message: 'INVALID_CREDENTIALS',
    });
    expect(hasher.verifyAgainstDummy).toHaveBeenCalledTimes(1);
    expect(hasher.verifyAgainstDummy).toHaveBeenCalledWith('whatever password');
    expect(hasher.verify).not.toHaveBeenCalled();
    expect(refreshTokens.issue).not.toHaveBeenCalled();
  });

  it('answers INVALID_CREDENTIALS to a user without local credential', async () => {
    userRepo.findOne!.mockResolvedValue(ada);
    credentials.hashOf.mockResolvedValue(null);
    const refusal = await refusalOf(
      service.login('ada@example.test', 'whatever password', NOW),
    );
    expect(refusal).toEqual({
      code: status.UNAUTHENTICATED,
      message: 'INVALID_CREDENTIALS',
    });
    expect(hasher.verify).not.toHaveBeenCalled();
    expect(refreshTokens.issue).not.toHaveBeenCalled();
    // Same cost as an unknown e-mail: one argon2 verification, so the
    // answer time does not tell an account without a password apart.
    expect(hasher.verifyAgainstDummy).toHaveBeenCalledTimes(1);
    expect(hasher.verifyAgainstDummy).toHaveBeenCalledWith('whatever password');
  });

  it('finds the account whatever the case of the e-mail typed', async () => {
    givenValidLogin();
    await service.login('  Ada@Example.TEST ', 'the right password', NOW);
    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'ada@example.test' },
    });
  });

  it('answers a session in epoch milliseconds with the user email and name', async () => {
    givenValidLogin();
    const session = await service.login(
      'ada@example.test',
      'the right password',
      NOW,
    );
    expect(session.accessTokenExpiresAt).toBe(NOW.getTime() + 900_000);
    expect(session.refreshTokenExpiresAt).toBe(
      NOW.getTime() + REFRESH_FAMILY_TTL_MS,
    );
    expect(session.name).toBe('Ada Lovelace');
    expect(session.email).toBe('ada@example.test');
  });

  it('maps a race to REFRESH_RACE', async () => {
    refreshTokens.rotate.mockResolvedValue({ kind: 'race' });
    const refusal = await refusalOf(service.refresh(REFRESH_TOKEN, NOW));
    expect(refusal).toEqual({ code: status.ABORTED, message: 'REFRESH_RACE' });
    expect(refreshTokens.issue).not.toHaveBeenCalled();
  });

  it('maps a reuse to REFRESH_INVALID, the same refusal as an unknown token', async () => {
    refreshTokens.rotate.mockResolvedValue({
      kind: 'reused',
      userId: USER_ID,
      familyId: FAMILY_ID,
    });
    const reused = await refusalOf(service.refresh(REUSED_TOKEN, NOW));
    expect(reused).toEqual({
      code: status.UNAUTHENTICATED,
      message: 'REFRESH_INVALID',
    });
    refreshTokens.rotate.mockResolvedValue({ kind: 'invalid' });
    const unknown = await refusalOf(service.refresh('unknown-token', NOW));
    expect(unknown).toEqual(reused);
  });

  it('logs a reuse without the token', async () => {
    refreshTokens.rotate.mockResolvedValue({
      kind: 'reused',
      userId: USER_ID,
      familyId: FAMILY_ID,
    });
    await refusalOf(service.refresh(REUSED_TOKEN, NOW));
    expect(logger.warn).toHaveBeenCalledWith(
      `AUTH_REFRESH_REUSE user=${USER_ID} family=${FAMILY_ID}`,
    );
    const logged = [logger.warn, logger.log, logger.error, logger.debug]
      .flatMap((m) => m.mock.calls)
      .flat()
      .map(String);
    expect(logged.some((line) => line.includes(REUSED_TOKEN))).toBe(false);
  });

  it('rotates a refresh token into a session that keeps the family expiry', async () => {
    const familyExpiry = new Date(NOW.getTime() + REFRESH_FAMILY_TTL_MS);
    refreshTokens.rotate.mockResolvedValue({
      kind: 'rotated',
      userId: USER_ID,
      token: 'the-new-refresh-token',
      expiresAt: familyExpiry,
    });
    userRepo.findOne!.mockResolvedValue(ada);
    const session = await service.refresh(REFRESH_TOKEN, NOW);
    expect(session.refreshToken).toBe('the-new-refresh-token');
    expect(session.refreshTokenExpiresAt).toBe(familyExpiry.getTime());
    expect(session.userId).toBe(USER_ID);
    expect(session.name).toBe('Ada Lovelace');
    // No new family: the rotated token replaces the old one.
    expect(refreshTokens.issue).not.toHaveBeenCalled();
  });

  it('logout of an unknown token succeeds', async () => {
    await expect(service.logout('unknown-token', NOW)).resolves.toBeUndefined();
    expect(refreshTokens.revokeFamilyOf).toHaveBeenCalledWith(
      'unknown-token',
      NOW,
    );
  });

  it('maps the signing keys to LocalJwk field by field', async () => {
    signingKeys.jwks.mockResolvedValue([
      {
        kty: 'EC' as const,
        crv: 'P-256' as const,
        x: 'eX',
        y: 'eY',
        kid: KID,
        alg: 'ES256' as const,
        use: 'sig' as const,
      },
    ]);
    await expect(service.jwks()).resolves.toEqual([
      {
        kid: KID,
        kty: 'EC',
        crv: 'P-256',
        x: 'eX',
        y: 'eY',
        alg: 'ES256',
        use: 'sig',
      },
    ]);
  });

  it('changes the password, signs every session out and opens a new one', async () => {
    credentials.changePassword.mockResolvedValue(undefined);
    userRepo.findOne!.mockResolvedValue(ada);
    refreshTokens.issue.mockResolvedValue({
      token: 'the-fresh-refresh-token',
      expiresAt: new Date(NOW.getTime() + REFRESH_FAMILY_TTL_MS),
    });
    const session = await service.changePassword(
      USER_ID,
      'the current password',
      'the new password',
      NOW,
    );
    expect(credentials.changePassword).toHaveBeenCalledWith(
      USER_ID,
      'the current password',
      'the new password',
      NOW,
    );
    expect(refreshTokens.revokeAllOfUser).toHaveBeenCalledWith(USER_ID, NOW);
    // The credential change comes first, then the revocation, then the session.
    expect(credentials.changePassword.mock.invocationCallOrder[0]).toBeLessThan(
      refreshTokens.revokeAllOfUser.mock.invocationCallOrder[0],
    );
    expect(
      refreshTokens.revokeAllOfUser.mock.invocationCallOrder[0],
    ).toBeLessThan(refreshTokens.issue.mock.invocationCallOrder[0]);
    expect(session.refreshToken).toBe('the-fresh-refresh-token');
    expect(session.userId).toBe(USER_ID);
  });

  it('answers CURRENT_PASSWORD_INVALID and revokes nothing for a wrong current password', async () => {
    credentials.changePassword.mockRejectedValue(
      localAuthRefusal('CURRENT_PASSWORD_INVALID'),
    );
    const refusal = await refusalOf(
      service.changePassword(USER_ID, 'wrong current', 'the new password', NOW),
    );
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'CURRENT_PASSWORD_INVALID',
    });
    expect(refreshTokens.revokeAllOfUser).not.toHaveBeenCalled();
    expect(refreshTokens.issue).not.toHaveBeenCalled();
  });

  it('openSession answers the user row in epoch milliseconds', async () => {
    userRepo.findOne!.mockResolvedValue(ada);
    const session: LocalAuthSession = await service.openSession(USER_ID, NOW);
    expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(session.accessTokenExpiresAt).toBe(NOW.getTime() + 900_000);
    expect(session.refreshTokenExpiresAt).toBe(
      NOW.getTime() + REFRESH_FAMILY_TTL_MS,
    );
    expect(session.name).toBe('Ada Lovelace');
    expect(session.email).toBe('ada@example.test');
  });
});
