import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import {
  type LocalPat,
  PersonalAccessTokenStore,
} from 'src/modules/local-auth/personal-access-token.store';
import { RefreshTokenStore } from 'src/modules/local-auth/refresh-token.store';
import type { IdentityProviderPort } from '../ports/identity-provider.port';
import { IDENTITY_PROVIDER_PORT } from '../ports/identity-provider.port';
import { IDENTITY_PROVIDER_COMMUNITY_BINDINGS } from './identity-provider.binding';
import {
  CommunityIdentityProvider,
  PAT_PASSWORD_REQUIRED_MESSAGE,
} from './identity-provider.community';

describe('CommunityIdentityProvider (IDENTITY_PROVIDER_PORT, community edition)', () => {
  let module: TestingModule;
  let port: IdentityProviderPort;
  const pats = {
    create: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
    revokeByName: jest.fn(),
    rename: jest.fn(),
    verify: jest.fn(),
    countActiveForOrganization: jest.fn(),
    revokeAllForOrganization: jest.fn(),
    revokeAllOfUser: jest.fn(),
  };
  const refreshTokens = {
    revokeAllOfUser: jest.fn(),
  };

  const organization = { id: 'o1', name: 'Org' };
  const user = { id: 'u1', email: 'u1@example.com' };
  const invitation = {
    id: 'inv1',
    email: 'invitee@example.com',
    role: 'member',
    expiresAt: new Date(0),
  };

  const pat = (over: Partial<LocalPat> = {}): LocalPat => ({
    id: '77777777-7777-4777-8777-777777777777',
    name: 'ci',
    lastFour: 'wxyz',
    createdAt: new Date(1_000),
    lastUsedAt: null,
    expiresAt: new Date(2_000),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({
      providers: [
        ...IDENTITY_PROVIDER_COMMUNITY_BINDINGS,
        { provide: PersonalAccessTokenStore, useValue: pats },
        { provide: RefreshTokenStore, useValue: refreshTokens },
      ],
    }).compile();
    port = module.get<IdentityProviderPort>(IDENTITY_PROVIDER_PORT);
  });

  afterEach(async () => {
    await module.close();
  });

  it('binds IDENTITY_PROVIDER_PORT to CommunityIdentityProvider', () => {
    expect(port).toBeInstanceOf(CommunityIdentityProvider);
  });

  it('mirrors nothing', async () => {
    await expect(
      port.organizationCreated(organization, user),
    ).resolves.toBeUndefined();
    await expect(
      port.organizationRenamed(organization),
    ).resolves.toBeUndefined();
    await expect(
      port.organizationDeleted(organization),
    ).resolves.toBeUndefined();
    await expect(
      port.invitationCreated(organization, invitation, user),
    ).resolves.toBeUndefined();
    await expect(
      port.invitationCanceled({ ...invitation, organizationId: 'o1' }),
    ).resolves.toBeUndefined();
    await expect(
      port.memberAdded(organization, user, 'member'),
    ).resolves.toBeUndefined();
    await expect(
      port.memberRoleChanged(organization, user, 'manager'),
    ).resolves.toBeUndefined();
    await expect(port.userDeleted(user)).resolves.toBeUndefined();
  });

  // A member removed from an organisation must sign in again: a session or a
  // token kept from before would let the account act on (create an
  // organisation, start scans) as if nothing happened.
  it('signs a leaving member out everywhere: every refresh session and every personal access token', async () => {
    refreshTokens.revokeAllOfUser.mockResolvedValue(undefined);
    pats.revokeAllOfUser.mockResolvedValue(2);

    await expect(
      port.memberLeaving(organization, user),
    ).resolves.toBeUndefined();

    expect(refreshTokens.revokeAllOfUser).toHaveBeenCalledWith(
      'u1',
      expect.any(Date),
    );
    expect(pats.revokeAllOfUser).toHaveBeenCalledWith('u1', expect.any(Date));
  });

  it('rejects when the revocation fails, so the removal stops before anything is removed', async () => {
    refreshTokens.revokeAllOfUser.mockResolvedValue(undefined);
    pats.revokeAllOfUser.mockRejectedValue(new Error('db down'));

    await expect(port.memberLeaving(organization, user)).rejects.toThrow(
      'db down',
    );
  });

  it('removeMember has no membership copy to drop and signs no one out', async () => {
    await expect(
      port.removeMember(organization, user),
    ).resolves.toBeUndefined();
    expect(refreshTokens.revokeAllOfUser).not.toHaveBeenCalled();
    expect(pats.revokeAllOfUser).not.toHaveBeenCalled();
  });

  // ─── Personal access tokens: the local store ─────────────────────

  it('lists personal access tokens without their value', async () => {
    pats.list.mockResolvedValue([
      pat(),
      pat({ name: 'deploy', expiresAt: null }),
    ]);

    const tokens = await port.listPersonalAccessTokens('u1');

    expect(tokens).toEqual([
      { name: 'ci', value: '', createdAt: 1_000, expiresAt: 2_000 },
      { name: 'deploy', value: '', createdAt: 1_000, expiresAt: 0 },
    ]);
    expect(pats.list).toHaveBeenCalledWith('u1', expect.any(Date));
  });

  it('refuses to create a token without the password: FAILED_PRECONDITION naming the route that asks for it', async () => {
    const thrown = await port
      .createPersonalAccessToken('u1', 'ci', 2_000)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.FAILED_PRECONDITION,
      message: PAT_PASSWORD_REQUIRED_MESSAGE,
    });
    expect(PAT_PASSWORD_REQUIRED_MESSAGE).toMatch(
      /^PAT_PASSWORD_REQUIRED: .*POST \/me\/personal-access-tokens/,
    );
    expect(pats.create).not.toHaveBeenCalled();
  });

  it('deletes, renames, counts and revokes through the store', async () => {
    pats.revokeByName.mockResolvedValue(undefined);
    await port.deletePersonalAccessToken('u1', 'ci');
    expect(pats.revokeByName).toHaveBeenCalledWith(
      'u1',
      'ci',
      expect.any(Date),
    );

    pats.rename.mockResolvedValue(pat({ name: 'cd', expiresAt: null }));
    const renamed = await port.renamePersonalAccessToken('u1', 'ci', 'cd');
    expect(renamed).toEqual({
      name: 'cd',
      value: '',
      createdAt: 1_000,
      expiresAt: 0,
    });
    expect(pats.rename).toHaveBeenCalledWith('u1', 'ci', 'cd');

    pats.countActiveForOrganization.mockResolvedValue(3);
    await expect(
      port.countPersonalAccessTokensForOrganization('o1'),
    ).resolves.toBe(3);
    expect(pats.countActiveForOrganization).toHaveBeenCalledWith(
      'o1',
      expect.any(Date),
    );

    pats.revokeAllForOrganization.mockResolvedValue(3);
    await expect(
      port.deleteAllPersonalAccessTokensForOrganization('o1'),
    ).resolves.toBe(3);
    expect(pats.revokeAllForOrganization).toHaveBeenCalledWith(
      'o1',
      expect.any(Date),
    );
  });
});
