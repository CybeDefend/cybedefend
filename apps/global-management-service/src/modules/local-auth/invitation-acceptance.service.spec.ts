import 'reflect-metadata';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import type { LocalAuthSession } from '@grpc/global-management/local_auth';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { User } from 'src/entities/user.entity';
import { OrganizationService } from 'src/modules/organization/organization.service';
import {
  createLoggerMock,
  createMockRepository,
  type MockType,
} from 'src/test-utils/typeorm-mock.util';
import { LocalAccountService } from './local-account.service';
import { LocalAuthService } from './local-auth.service';
import { InvitationAcceptanceService } from './invitation-acceptance.service';
import { tokenHash } from './token-hash';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const TOKEN = 'a'.repeat(64); // randomBytes(32).toString('hex')
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const INVITATION_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const PASSWORD = 'the-invitee-password-1';

const SESSION: LocalAuthSession = {
  accessToken: 'the.jwt',
  accessTokenExpiresAt: 1_800_000_000_900_000,
  refreshToken: 'the-refresh-token',
  refreshTokenExpiresAt: 1_800_000_000_000_000,
  userId: USER_ID,
  email: 'ada@example.test',
  name: 'Ada Lovelace',
};

const invitee = {
  id: USER_ID,
  email: 'ada@example.test',
  firstName: 'Ada Lovelace',
  lastName: '',
} as User;

function invitationOf(
  over: Partial<OrganizationInvitation> = {},
): OrganizationInvitation {
  return {
    id: INVITATION_ID,
    tokenHash: tokenHash(TOKEN),
    email: 'ada@example.test',
    role: 'developer',
    status: 'pending',
    expiresAt: new Date(NOW.getTime() + 24 * 3600 * 1000),
    organization: { id: ORG_ID },
    ...over,
  } as OrganizationInvitation;
}

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

describe('InvitationAcceptanceService', () => {
  let invitationRepo: MockType<Repository<OrganizationInvitation>>;
  let userRepo: MockType<Repository<User>>;
  let accounts: { createAccount: jest.Mock };
  let auth: { openSession: jest.Mock };
  let organizations: { acceptInvitationFromOrganization: jest.Mock };
  let logger: ReturnType<typeof createLoggerMock>;
  let service: InvitationAcceptanceService;

  beforeEach(() => {
    invitationRepo = createMockRepository<OrganizationInvitation>();
    userRepo = createMockRepository<User>();
    accounts = { createAccount: jest.fn(async () => invitee) };
    auth = { openSession: jest.fn(async () => SESSION) };
    organizations = {
      acceptInvitationFromOrganization: jest.fn(async () => ({
        message: 'Invitation accepted successfully',
        organization: { id: ORG_ID },
      })),
    };
    logger = createLoggerMock();
    service = new InvitationAcceptanceService(
      invitationRepo as unknown as Repository<OrganizationInvitation>,
      userRepo as unknown as Repository<User>,
      accounts as unknown as LocalAccountService,
      auth as unknown as LocalAuthService,
      organizations as unknown as OrganizationService,
      logger as unknown as Logger,
    );
  });

  function input(overrides: Record<string, string> = {}) {
    return {
      token: TOKEN,
      password: PASSWORD,
      name: 'Ada Lovelace',
      ...overrides,
    };
  }

  it('creates the account and joins the organisation', async () => {
    invitationRepo.findOne!.mockResolvedValue(invitationOf());
    userRepo.findOne!.mockResolvedValue(null);

    const result = await service.accept(input(), NOW);

    // Only the token's hash is stored, and the lookup is by that hash alone.
    expect(invitationRepo.findOne).toHaveBeenCalledWith({
      where: { tokenHash: tokenHash(TOKEN) },
    });
    expect(JSON.stringify(invitationRepo.findOne.mock.calls)).not.toContain(
      TOKEN,
    );
    expect(accounts.createAccount).toHaveBeenCalledWith(
      { email: 'ada@example.test', password: PASSWORD, name: 'Ada Lovelace' },
      NOW,
    );
    expect(organizations.acceptInvitationFromOrganization).toHaveBeenCalledWith(
      { token: TOKEN, userId: USER_ID },
    );
    expect(auth.openSession).toHaveBeenCalledWith(USER_ID, NOW);
    expect(result).toEqual({ session: SESSION, organizationId: ORG_ID });
  });

  it('refuses an unknown token with INVITATION_INVALID', async () => {
    invitationRepo.findOne!.mockResolvedValue(null);
    const refusal = await refusalOf(service.accept(input(), NOW));
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(accounts.createAccount).not.toHaveBeenCalled();
    expect(auth.openSession).not.toHaveBeenCalled();
  });

  it('refuses an expired invitation with INVITATION_INVALID', async () => {
    invitationRepo.findOne!.mockResolvedValue(
      invitationOf({ expiresAt: new Date(NOW.getTime() - 1000) }),
    );
    const refusal = await refusalOf(service.accept(input(), NOW));
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(accounts.createAccount).not.toHaveBeenCalled();
  });

  it('refuses a canceled invitation with INVITATION_INVALID', async () => {
    invitationRepo.findOne!.mockResolvedValue(
      invitationOf({ status: 'canceled' }),
    );
    const refusal = await refusalOf(service.accept(input(), NOW));
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(accounts.createAccount).not.toHaveBeenCalled();
  });

  it('refuses an already accepted invitation with INVITATION_INVALID', async () => {
    invitationRepo.findOne!.mockResolvedValue(
      invitationOf({ status: 'accepted' }),
    );
    const refusal = await refusalOf(service.accept(input(), NOW));
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(accounts.createAccount).not.toHaveBeenCalled();
  });

  it('refuses a malformed token without a query', async () => {
    const refusal = await refusalOf(
      service.accept(input({ token: 'not-a-hex-token' }), NOW),
    );
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(invitationRepo.findOne).not.toHaveBeenCalled();

    const short = await refusalOf(
      service.accept(input({ token: 'a'.repeat(63) }), NOW),
    );
    expect(short.message).toBe('INVITATION_INVALID');
    expect(invitationRepo.findOne).not.toHaveBeenCalled();

    const upper = await refusalOf(
      service.accept(input({ token: 'A'.repeat(64) }), NOW),
    );
    expect(upper.message).toBe('INVITATION_INVALID');
    expect(invitationRepo.findOne).not.toHaveBeenCalled();
  });

  it('refuses a short password with PASSWORD_POLICY', async () => {
    invitationRepo.findOne!.mockResolvedValue(invitationOf());
    const refusal = await refusalOf(
      service.accept(input({ password: 'too short' }), NOW),
    );
    expect(refusal).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'PASSWORD_POLICY',
    });
    expect(accounts.createAccount).not.toHaveBeenCalled();
  });

  it('answers ACCOUNT_EXISTS when the e-mail has an account', async () => {
    invitationRepo.findOne!.mockResolvedValue(invitationOf());
    userRepo.findOne!.mockResolvedValue({
      id: '99999999-9999-4999-8999-999999999999',
      email: 'ada@example.test',
    } as User);
    const refusal = await refusalOf(service.accept(input(), NOW));
    expect(refusal).toEqual({
      code: status.ALREADY_EXISTS,
      message: 'ACCOUNT_EXISTS',
    });
    // The existing account is never attached to the invitation here: it
    // signs in and accepts through the authenticated AcceptInvitation RPC.
    expect(accounts.createAccount).not.toHaveBeenCalled();
    expect(
      organizations.acceptInvitationFromOrganization,
    ).not.toHaveBeenCalled();
    expect(auth.openSession).not.toHaveBeenCalled();
  });

  it('creates the account under the lower-cased invitation e-mail', async () => {
    invitationRepo.findOne!.mockResolvedValue(
      invitationOf({ email: 'Ada@Example.TEST' }),
    );
    userRepo.findOne!.mockResolvedValue(null);

    await service.accept(input(), NOW);

    expect(userRepo.findOne).toHaveBeenCalledWith({
      where: { email: 'ada@example.test' },
    });
    expect(accounts.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.test' }),
      NOW,
    );
  });

  function givenANewInvitee(): void {
    invitationRepo.findOne!.mockResolvedValue(invitationOf());
    userRepo.findOne!.mockResolvedValue(null);
  }

  it('deletes the new account when the acceptance fails', async () => {
    givenANewInvitee();
    organizations.acceptInvitationFromOrganization.mockRejectedValueOnce(
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has expired',
      }),
    );

    expect(await refusalOf(service.accept(input(), NOW))).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(userRepo.delete).toHaveBeenCalledWith({ id: USER_ID });
    expect(auth.openSession).not.toHaveBeenCalled();
  });

  it('the inviter may no longer grant the role → INVITATION_INVALID, account deleted', async () => {
    givenANewInvitee();
    organizations.acceptInvitationFromOrganization.mockRejectedValueOnce(
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation is no longer valid',
      }),
    );

    expect(await refusalOf(service.accept(input(), NOW))).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'INVITATION_INVALID',
    });
    expect(userRepo.delete).toHaveBeenCalledWith({ id: USER_ID });
    expect(auth.openSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      'already accepted or canceled (FAILED_PRECONDITION)',
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation already accepted or canceled',
      }),
    ],
    [
      'not found (NOT_FOUND)',
      new RpcException({
        code: status.NOT_FOUND,
        message: 'Invitation not found',
      }),
    ],
    [
      'sent to another address (PERMISSION_DENIED)',
      new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'This invitation was sent to a different email address',
      }),
    ],
    [
      'a grpc ServiceError (FAILED_PRECONDITION)',
      Object.assign(new Error('9 FAILED_PRECONDITION: Invitation expired'), {
        code: status.FAILED_PRECONDITION,
        details: 'Invitation expired',
      }),
    ],
  ])(
    'answers INVITATION_INVALID, never the free text, for %s',
    async (_label, refusal) => {
      givenANewInvitee();
      organizations.acceptInvitationFromOrganization.mockRejectedValueOnce(
        refusal,
      );

      expect(await refusalOf(service.accept(input(), NOW))).toEqual({
        code: status.INVALID_ARGUMENT,
        message: 'INVITATION_INVALID',
      });
      expect(userRepo.delete).toHaveBeenCalledWith({ id: USER_ID });
    },
  );

  it.each([
    [
      'an INTERNAL RpcException',
      new RpcException({ code: status.INTERNAL, message: 'db down' }),
    ],
    ['a plain Error', new TypeError('unexpected')],
  ])(
    'still rethrows an unexpected error unchanged (%s), account deleted',
    async (_label, boom) => {
      givenANewInvitee();
      organizations.acceptInvitationFromOrganization.mockRejectedValueOnce(
        boom,
      );

      const thrown = await service.accept(input(), NOW).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(thrown).toBe(boom);
      expect(userRepo.delete).toHaveBeenCalledWith({ id: USER_ID });
      expect(auth.openSession).not.toHaveBeenCalled();
    },
  );
});
