import 'reflect-metadata';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import type { Logger } from 'nestjs-pino';
import type { MailService } from 'src/modules/mail/mail.service';
import { User } from 'src/entities/user.entity';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { LocalCredentialStore } from './local-credential.store';
import { OneTimeTokenStore } from './one-time-token.store';
import { ResetRequesterKeyer } from './reset-requester-key';
import {
  passwordResetLink,
  PasswordResetService,
} from './password-reset.service';
import { PasswordHasher } from './password-hasher';
import { PersonalAccessTokenStore } from './personal-access-token.store';
import { RefreshTokenStore } from './refresh-token.store';

/**
 * Unit spec of the password reset. No account enumeration: request
 * answers the same for a known and an unknown e-mail, and resolves before the
 * reset mail is sent, so a known e-mail is not
 * slower; the 3 per hour per user cap is silent (no refusal code travels);
 * reset checks the policy first, then consumes the one-time token
 * (RESET_TOKEN_INVALID when used, expired or unknown), sets the credential and
 * revokes every refresh family of the user. The CLI path lower-cases the
 * e-mail too, bypasses the hourly limit and answers NO_LOCAL_ACCOUNT for an
 * unknown e-mail.
 */

const NOW = new Date('2026-11-03T10:00:00.000Z');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const FRONTEND_URL = 'https://app.example.test';
const NEW_PASSWORD = 'a-brand-new-password-1';

/** Lets the detached issue-and-mail chain run to its end. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const ada = {
  id: USER_ID,
  email: 'ada@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
} as User;

describe('PasswordResetService', () => {
  let userRepo: { findOne: jest.Mock };
  let tokens: {
    createPasswordReset: jest.Mock;
    consumePasswordReset: jest.Mock;
    expireOpenPasswordResets: jest.Mock;
  };
  let credentials: { hashOf: jest.Mock; set: jest.Mock };
  let hasher: { hash: jest.Mock };
  let refreshTokens: { revokeAllOfUser: jest.Mock };
  let pats: { revokeAllOfUser: jest.Mock };
  let mail: { isConfigured: jest.Mock; sendPasswordResetEmail: jest.Mock };
  let config: { get: jest.Mock };
  let keyer: { keyOf: jest.Mock };
  let logger: ReturnType<typeof createLoggerMock>;
  let manager: Record<string, unknown>;
  let dataSource: DataSource;
  let service: PasswordResetService;

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    tokens = {
      createPasswordReset: jest.fn(),
      consumePasswordReset: jest.fn(),
      expireOpenPasswordResets: jest.fn(async () => 0),
    };
    credentials = { hashOf: jest.fn(), set: jest.fn(async () => undefined) };
    hasher = { hash: jest.fn(async () => 'the-new-hash') };
    refreshTokens = { revokeAllOfUser: jest.fn(async () => undefined) };
    pats = { revokeAllOfUser: jest.fn(async () => 0) };
    mail = {
      isConfigured: jest.fn(() => true),
      sendPasswordResetEmail: jest.fn(async () => true),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'FRONTEND_URL' ? FRONTEND_URL : undefined,
      ),
    };
    logger = createLoggerMock();
    keyer = { keyOf: jest.fn((ip?: string) => `hmac(${ip ?? ''})`) };
    manager = {};
    dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
        fn(manager),
      ),
    } as unknown as DataSource;
    service = new PasswordResetService(
      dataSource,
      userRepo as unknown as Repository<User>,
      tokens as unknown as OneTimeTokenStore,
      credentials as unknown as LocalCredentialStore,
      hasher as unknown as PasswordHasher,
      refreshTokens as unknown as RefreshTokenStore,
      mail as unknown as MailService,
      config as unknown as ConfigService,
      logger as unknown as Logger,
      keyer as unknown as ResetRequesterKeyer,
      pats as unknown as PersonalAccessTokenStore,
    );
  });

  function givenKnownAccount(): void {
    userRepo.findOne.mockResolvedValue(ada);
    credentials.hashOf.mockResolvedValue(HASH);
  }

  describe('request', () => {
    it("hands the store the keyed HMAC of the requester's address, never the address", async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue('tok');

      await service.request('ada@example.test', NOW, '203.0.113.7');
      await flush();

      expect(keyer.keyOf).toHaveBeenCalledWith('203.0.113.7');
      expect(tokens.createPasswordReset).toHaveBeenCalledWith(USER_ID, NOW, {
        requesterKey: 'hmac(203.0.113.7)',
      });
    });

    it('answers the same for a known and an unknown e-mail', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue('the-reset-token');

      await expect(
        service.request('ada@example.test', NOW),
      ).resolves.toBeUndefined();
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.request('nobody@example.test', NOW),
      ).resolves.toBeUndefined();
      await flush();

      // the mail went out only for the known account
      expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith({
        to: 'ada@example.test',
        link: `${FRONTEND_URL}/reset-password#token=the-reset-token`,
      });
    });

    it('finds the account whatever the case of the e-mail', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue('tok');

      await service.request('Ada@Example.TEST', NOW);

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'ada@example.test' },
      });
    });

    it('answers before the reset mail is sent', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue('tok');
      // a mail that never settles must not hold the answer
      mail.sendPasswordResetEmail.mockReturnValue(new Promise(() => undefined));

      await expect(
        service.request('ada@example.test', NOW),
      ).resolves.toBeUndefined();
      await flush();
      expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('answers before the reset token is written, as for an unknown e-mail', async () => {
      givenKnownAccount();
      // neither a slow credential read nor a token transaction that never
      // settles may hold the answer: its timing would tell a real account
      credentials.hashOf.mockReturnValue(new Promise(() => undefined));
      const known = await service.request('ada@example.test', NOW);

      credentials.hashOf.mockResolvedValue(HASH);
      tokens.createPasswordReset.mockReturnValue(new Promise(() => undefined));
      const knownSlowToken = await service.request('ada@example.test', NOW);

      userRepo.findOne.mockResolvedValue(null);
      const unknown = await service.request('nobody@example.test', NOW);

      expect(known).toBeUndefined();
      expect(knownSlowToken).toBeUndefined();
      expect(unknown).toBe(known);
      await flush();
      expect(tokens.createPasswordReset).toHaveBeenCalledTimes(1);
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('logs a failed token write by class name only, and still resolves', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockRejectedValue(
        new RangeError('deadlock on ada@example.test'),
      );

      await expect(
        service.request('ada@example.test', NOW),
      ).resolves.toBeUndefined();
      await flush();

      const logged = [logger.error, logger.warn, logger.log, logger.debug]
        .flatMap((m) => m.mock.calls)
        .flat()
        .map(String);
      expect(logged.some((line) => line.includes('RangeError'))).toBe(true);
      expect(logged.some((line) => line.includes('ada@example.test'))).toBe(
        false,
      );
    });

    it('logs a mail failure by class name only, and still resolves', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue('tok');
      mail.sendPasswordResetEmail.mockRejectedValue(new TypeError('smtp down'));

      await expect(
        service.request('ada@example.test', NOW),
      ).resolves.toBeUndefined();
      await flush();

      const logged = [logger.error, logger.warn, logger.log, logger.debug]
        .flatMap((m) => m.mock.calls)
        .flat()
        .map(String);
      expect(logged.some((line) => line.includes('TypeError'))).toBe(true);
      // never the token, the link or the address
      expect(logged.some((line) => line.includes('tok'))).toBe(false);
      expect(logged.some((line) => line.includes('ada@example.test'))).toBe(
        false,
      );
    });

    it('sends no fourth reset within the hour', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue(null); // the silent cap

      await expect(
        service.request('ada@example.test', NOW),
      ).resolves.toBeUndefined();
      await flush();

      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('sends nothing without SMTP', async () => {
      givenKnownAccount();
      mail.isConfigured.mockReturnValue(false);

      await service.request('ada@example.test', NOW);
      await flush();

      expect(tokens.createPasswordReset).not.toHaveBeenCalled();
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('sends nothing for a user without a local credential', async () => {
      userRepo.findOne.mockResolvedValue(ada);
      credentials.hashOf.mockResolvedValue(null);

      await service.request('ada@example.test', NOW);
      await flush();

      expect(tokens.createPasswordReset).not.toHaveBeenCalled();
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('changes the password and revokes every session and personal access token in the same transaction', async () => {
      tokens.consumePasswordReset.mockResolvedValue(USER_ID);

      await service.reset('the-reset-token', NEW_PASSWORD, NOW);

      expect(tokens.consumePasswordReset).toHaveBeenCalledWith(
        'the-reset-token',
        NOW,
        manager,
      );
      expect(hasher.hash).toHaveBeenCalledWith(NEW_PASSWORD);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(credentials.set).toHaveBeenCalledWith(
        manager,
        USER_ID,
        'the-new-hash',
        NOW,
      );
      expect(refreshTokens.revokeAllOfUser).toHaveBeenCalledWith(
        USER_ID,
        NOW,
        manager,
      );
      expect(pats.revokeAllOfUser).toHaveBeenCalledWith(USER_ID, NOW, manager);
    });

    it("expires the user's other open reset links in the transaction that sets the password", async () => {
      tokens.consumePasswordReset.mockResolvedValue(USER_ID);
      const order: string[] = [];
      credentials.set.mockImplementation(async () => {
        order.push('set');
      });
      tokens.expireOpenPasswordResets.mockImplementation(async () => {
        order.push('expire');
        return 2;
      });

      await service.reset('the-reset-token', NEW_PASSWORD, NOW);

      expect(tokens.expireOpenPasswordResets).toHaveBeenCalledWith(
        USER_ID,
        NOW,
        manager,
      );
      expect(order).toEqual(['set', 'expire']);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses a used or expired token with RESET_TOKEN_INVALID', async () => {
      tokens.consumePasswordReset.mockResolvedValue(null);

      const thrown = await service
        .reset('a-used-or-expired-token', NEW_PASSWORD, NOW)
        .catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'RESET_TOKEN_INVALID',
      });
      expect(credentials.set).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllOfUser).not.toHaveBeenCalled();
      expect(pats.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it('hashes before consuming the token: a busy verifier leaves the link usable', async () => {
      const busy = new RpcException({
        code: status.UNAVAILABLE,
        message: 'PASSWORD_VERIFICATION_BUSY',
      });
      hasher.hash.mockRejectedValue(busy);
      tokens.consumePasswordReset.mockResolvedValue(USER_ID);

      await expect(
        service.reset('the-reset-token', NEW_PASSWORD, NOW),
      ).rejects.toBe(busy);

      expect(tokens.consumePasswordReset).not.toHaveBeenCalled();
      expect(credentials.set).not.toHaveBeenCalled();
    });

    it('consumes the token and sets the credential in one transaction, after the hash', async () => {
      const order: string[] = [];
      hasher.hash.mockImplementation(async () => {
        order.push('hash');
        return 'the-new-hash';
      });
      tokens.consumePasswordReset.mockImplementation(async () => {
        order.push('consume');
        return USER_ID;
      });
      credentials.set.mockImplementation(async () => {
        order.push('set');
      });

      await service.reset('the-reset-token', NEW_PASSWORD, NOW);

      expect(order).toEqual(['hash', 'consume', 'set']);
      expect(tokens.consumePasswordReset).toHaveBeenCalledWith(
        'the-reset-token',
        NOW,
        manager,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it("answers the account's e-mail, so the gateway can clear its login counter", async () => {
      tokens.consumePasswordReset.mockResolvedValue(USER_ID);
      userRepo.findOne.mockResolvedValue(ada);

      await expect(
        service.reset('the-reset-token', NEW_PASSWORD, NOW),
      ).resolves.toEqual({ email: 'ada@example.test' });
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: USER_ID },
      });
    });

    it('checks the policy before consuming the token', async () => {
      const thrown = await service
        .reset('the-reset-token', 'short', NOW)
        .catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'PASSWORD_POLICY',
      });
      expect(tokens.consumePasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('issueLinkForCli', () => {
    it('returns the link for a known e-mail, bypassing the hourly limit', async () => {
      givenKnownAccount();
      tokens.createPasswordReset.mockResolvedValue('cli-token');

      const link = await service.issueLinkForCli('Ada@Example.TEST', NOW);

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'ada@example.test' },
      });
      expect(tokens.createPasswordReset).toHaveBeenCalledWith(USER_ID, NOW, {
        bypassLimit: true,
      });
      expect(link).toBe(`${FRONTEND_URL}/reset-password#token=cli-token`);
      // no mail from the CLI path
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('answers NO_LOCAL_ACCOUNT for an unknown e-mail', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.issueLinkForCli('nobody@example.test', NOW),
      ).rejects.toThrow('NO_LOCAL_ACCOUNT');

      expect(tokens.createPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('passwordResetLink', () => {
    it('puts the token in the link fragment', () => {
      expect(passwordResetLink('https://x/', 't')).toBe(
        'https://x/reset-password#token=t',
      );
      expect(passwordResetLink('https://x', 't')).toBe(
        'https://x/reset-password#token=t',
      );
      expect(passwordResetLink('https://x///', 't')).toBe(
        'https://x/reset-password#token=t',
      );
    });
  });
});
