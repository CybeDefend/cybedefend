import { Test, TestingModule } from '@nestjs/testing';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { AuthorizationService } from './authorization.service';
import { PermifyService } from '../permify/permify.service';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

/**
 * A membership change must cost ONE Permify RPC to learn the
 * subject's relations on an entity, not one `check` per candidate relation.
 *
 * Every outcome asserted here is the behaviour the loop-of-checks
 * implementation already had (same messages, same delete/write sequence, same
 * gRPC status codes, same candidate precedence); only the RPC shape changes.
 * The `permify` mock therefore answers BOTH `checkPermission` and
 * `readRelationships` from the same set of held relations, so the outcome
 * assertions hold for either implementation and only the "1 readRelationships,
 * 0 checkPermission" assertions discriminate between them.
 */
describe('AuthorizationService (one readRelationships per membership change)', () => {
  const ORGANIZATION_ROLES = [
    'administrator',
    'manager',
    'billing_manager',
    'member',
  ];
  const TEAM_ROLES = [
    'team_manager',
    'analyst_developer',
    'developer',
    'read_only',
  ];

  let service: AuthorizationService;
  let permify: {
    checkPermission: jest.Mock;
    readRelationships: jest.Mock;
    writePermission: jest.Mock;
    deletePermission: jest.Mock;
    deleteAllPermissions: jest.Mock;
  };

  /** Declare which relations the subject holds on the entity. */
  const holds = (...relations: string[]): void => {
    permify.readRelationships.mockResolvedValue(relations);
    permify.checkPermission.mockImplementation(
      (
        _resourceId: string,
        _subjectId: string,
        _subjectType: string,
        _resourceType: string,
        permission: string,
      ) => Promise.resolve(relations.includes(permission)),
    );
  };

  const catchRpc = async (promise: Promise<unknown>): Promise<RpcException> => {
    try {
      await promise;
    } catch (error) {
      return error as RpcException;
    }
    throw new Error('expected the call to reject, but it resolved');
  };

  beforeEach(async () => {
    permify = {
      checkPermission: jest.fn().mockResolvedValue(false),
      readRelationships: jest.fn().mockResolvedValue([]),
      writePermission: jest.fn().mockResolvedValue(true),
      deletePermission: jest.fn().mockResolvedValue(true),
      deleteAllPermissions: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PermifyService, useValue: permify },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();

    service = module.get<AuthorizationService>(AuthorizationService);
  });

  describe('updateOrganizationRole', () => {
    const data = { organizationId: 'org-1', userId: 'user-1', role: 'manager' };

    it('reads the relations once and never checks them one by one', async () => {
      holds('member');

      await service.updateOrganizationRole(data);

      expect(permify.readRelationships).toHaveBeenCalledTimes(1);
      expect(permify.readRelationships).toHaveBeenCalledWith({
        entity: { type: 'organization', id: 'org-1' },
        subject: { type: 'user', id: 'user-1' },
      });
      expect(permify.checkPermission).not.toHaveBeenCalled();
    });

    it('replaces the held role by the requested one', async () => {
      holds('member');

      const result = await service.updateOrganizationRole(data);

      expect(permify.deletePermission).toHaveBeenCalledTimes(1);
      expect(permify.deletePermission).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'user',
        'organization',
        'member',
      );
      expect(permify.writePermission).toHaveBeenCalledTimes(1);
      expect(permify.writePermission).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'user',
        'organization',
        'manager',
      );
      expect(result).toEqual({
        message: 'User user-1 role updated to manager in organization org-1',
      });
    });

    it('is a no-op when the user already holds the requested role', async () => {
      holds('manager');

      const result = await service.updateOrganizationRole(data);

      expect(permify.deletePermission).not.toHaveBeenCalled();
      expect(permify.writePermission).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'User user-1 already has role manager in organization org-1',
      });
    });

    it('acts on the first role of the candidate order when several are held', async () => {
      holds('member', 'administrator');

      await service.updateOrganizationRole(data);

      expect(permify.deletePermission).toHaveBeenCalledTimes(1);
      expect(permify.deletePermission).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'user',
        'organization',
        'administrator',
      );
    });

    it('ignores relations outside the candidate list (creator) and throws NOT_FOUND', async () => {
      holds('creator');

      const error = await catchRpc(service.updateOrganizationRole(data));

      expect(error).toBeInstanceOf(RpcException);
      expect(error.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User does not have any role in organization',
      });
      expect(permify.writePermission).not.toHaveBeenCalled();
      expect(permify.deletePermission).not.toHaveBeenCalled();
    });
  });

  describe('organizationRemoveMember', () => {
    const data = { organizationId: 'org-1', userId: 'user-1' };

    it('reads the relations once and never checks them one by one', async () => {
      holds('member');

      await service.organizationRemoveMember(data);

      expect(permify.readRelationships).toHaveBeenCalledTimes(1);
      expect(permify.readRelationships).toHaveBeenCalledWith({
        entity: { type: 'organization', id: 'org-1' },
        subject: { type: 'user', id: 'user-1' },
      });
      expect(permify.checkPermission).not.toHaveBeenCalled();
    });

    it('deletes every held candidate role, in candidate order', async () => {
      holds('member', 'manager');

      const result = await service.organizationRemoveMember(data);

      expect(permify.deletePermission).toHaveBeenCalledTimes(2);
      expect(
        permify.deletePermission.mock.calls.map((call) => call[4]),
      ).toEqual(['manager', 'member']);
      expect(result).toEqual({
        message: 'User user-1 removed from organization org-1',
      });
    });

    it('never deletes a relation outside the candidate list (creator)', async () => {
      holds('creator', 'member');

      await service.organizationRemoveMember(data);

      expect(permify.deletePermission).toHaveBeenCalledTimes(1);
      expect(permify.deletePermission).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'user',
        'organization',
        'member',
      );
    });

    it('succeeds without deleting anything when no candidate role is held', async () => {
      holds();

      const result = await service.organizationRemoveMember(data);

      expect(permify.deletePermission).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'User user-1 removed from organization org-1',
      });
    });
  });

  describe('organizationAddMember', () => {
    const data = { organizationId: 'org-1', userId: 'user-1', role: 'member' };

    it('writes the role after a single relations read', async () => {
      holds();

      const result = await service.organizationAddMember(data);

      expect(permify.readRelationships).toHaveBeenCalledTimes(1);
      expect(permify.readRelationships).toHaveBeenCalledWith({
        entity: { type: 'organization', id: 'org-1' },
        subject: { type: 'user', id: 'user-1' },
      });
      expect(permify.checkPermission).not.toHaveBeenCalled();
      expect(permify.writePermission).toHaveBeenCalledTimes(1);
      expect(permify.writePermission).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'user',
        'organization',
        'member',
      );
      expect(result).toEqual({
        message: 'User user-1 added to organization org-1 with role member',
        userId: 'user-1',
      });
    });

    it.each(ORGANIZATION_ROLES)(
      'refuses with ALREADY_EXISTS when the user already holds %s',
      async (role) => {
        holds(role);

        const error = await catchRpc(service.organizationAddMember(data));

        expect(error).toBeInstanceOf(RpcException);
        expect(error.getError()).toEqual({
          code: status.ALREADY_EXISTS,
          message: 'User already has a role in organization',
        });
        expect(permify.writePermission).not.toHaveBeenCalled();
      },
    );

    it('still writes when the only held relation is outside the candidate list (creator)', async () => {
      holds('creator');

      await service.organizationAddMember(data);

      expect(permify.writePermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('teamAddMember', () => {
    const data = { teamId: 'team-1', userId: 'user-1', role: 'developer' };

    it('does one readRelationships and one write, and no check', async () => {
      holds();

      const result = await service.teamAddMember(data);

      expect(permify.readRelationships).toHaveBeenCalledTimes(1);
      expect(permify.readRelationships).toHaveBeenCalledWith({
        entity: { type: 'team', id: 'team-1' },
        subject: { type: 'user', id: 'user-1' },
      });
      expect(permify.checkPermission).not.toHaveBeenCalled();
      expect(permify.writePermission).toHaveBeenCalledTimes(1);
      expect(permify.writePermission).toHaveBeenCalledWith(
        'team-1',
        'user-1',
        'user',
        'team',
        'developer',
      );
      expect(result).toEqual({
        message: 'User user-1 added to team team-1 with role developer',
      });
    });

    it.each(TEAM_ROLES)(
      'refuses with ALREADY_EXISTS when the user already holds %s',
      async (role) => {
        holds(role);

        const error = await catchRpc(service.teamAddMember(data));

        expect(error).toBeInstanceOf(RpcException);
        expect(error.getError()).toEqual({
          code: status.ALREADY_EXISTS,
          message: 'User already has a role in team',
        });
        expect(permify.writePermission).not.toHaveBeenCalled();
      },
    );
  });

  describe('teamUpdateMemberRole', () => {
    const data = { teamId: 'team-1', userId: 'user-1', role: 'team_manager' };

    it('reads the relations once and never checks them one by one', async () => {
      holds('developer');

      await service.teamUpdateMemberRole(data);

      expect(permify.readRelationships).toHaveBeenCalledTimes(1);
      expect(permify.readRelationships).toHaveBeenCalledWith({
        entity: { type: 'team', id: 'team-1' },
        subject: { type: 'user', id: 'user-1' },
      });
      expect(permify.checkPermission).not.toHaveBeenCalled();
    });

    it('replaces the held role by the requested one', async () => {
      holds('developer');

      const result = await service.teamUpdateMemberRole(data);

      expect(permify.deletePermission).toHaveBeenCalledWith(
        'team-1',
        'user-1',
        'user',
        'team',
        'developer',
      );
      expect(permify.writePermission).toHaveBeenCalledWith(
        'team-1',
        'user-1',
        'user',
        'team',
        'team_manager',
      );
      expect(result).toEqual({
        message: 'User user-1 role updated to team_manager in team team-1',
      });
    });

    it('is a no-op when the user already holds the requested role', async () => {
      holds('team_manager');

      const result = await service.teamUpdateMemberRole(data);

      expect(permify.deletePermission).not.toHaveBeenCalled();
      expect(permify.writePermission).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'User user-1 already has role team_manager in team team-1',
      });
    });

    it('acts on the first role of the candidate order when several are held', async () => {
      holds('read_only', 'analyst_developer');

      await service.teamUpdateMemberRole(data);

      expect(permify.deletePermission).toHaveBeenCalledTimes(1);
      expect(permify.deletePermission).toHaveBeenCalledWith(
        'team-1',
        'user-1',
        'user',
        'team',
        'analyst_developer',
      );
    });

    it('throws NOT_FOUND when no candidate role is held', async () => {
      holds();

      const error = await catchRpc(service.teamUpdateMemberRole(data));

      expect(error).toBeInstanceOf(RpcException);
      expect(error.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User does not have any role in team',
      });
      expect(permify.writePermission).not.toHaveBeenCalled();
    });
  });

  describe('removeMemberFromTeam', () => {
    const data = { teamId: 'team-1', userId: 'user-1' };

    it('deletes the first held role after a single relations read', async () => {
      holds('developer');

      const result = await service.removeMemberFromTeam(data);

      expect(permify.readRelationships).toHaveBeenCalledTimes(1);
      expect(permify.readRelationships).toHaveBeenCalledWith({
        entity: { type: 'team', id: 'team-1' },
        subject: { type: 'user', id: 'user-1' },
      });
      expect(permify.checkPermission).not.toHaveBeenCalled();
      expect(permify.deletePermission).toHaveBeenCalledTimes(1);
      expect(permify.deletePermission).toHaveBeenCalledWith(
        'team-1',
        'user-1',
        'user',
        'team',
        'developer',
      );
      expect(result).toEqual({
        message: 'User user-1 removed from team team-1',
      });
    });

    it('deletes only the first role of the candidate order when several are held', async () => {
      holds('read_only', 'team_manager');

      await service.removeMemberFromTeam(data);

      expect(permify.deletePermission).toHaveBeenCalledTimes(1);
      expect(permify.deletePermission).toHaveBeenCalledWith(
        'team-1',
        'user-1',
        'user',
        'team',
        'team_manager',
      );
    });

    it('throws NOT_FOUND when no candidate role is held', async () => {
      holds();

      const error = await catchRpc(service.removeMemberFromTeam(data));

      expect(error).toBeInstanceOf(RpcException);
      expect(error.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User does not have any role in team',
      });
      expect(permify.deletePermission).not.toHaveBeenCalled();
    });
  });

  describe('canAddTeamMember (may this user seat someone in this team?)', () => {
    it('answers with the team#add_user permission of that user on that team', async () => {
      permify.checkPermission.mockImplementation(
        (
          resourceId: string,
          subjectId: string,
          subjectType: string,
          resourceType: string,
          permission: string,
        ) =>
          Promise.resolve(
            resourceType === 'team' &&
              resourceId === 'team-1' &&
              subjectType === 'user' &&
              subjectId === 'user-1' &&
              permission === 'add_user',
          ),
      );

      await expect(service.canAddTeamMember('team-1', 'user-1')).resolves.toBe(
        true,
      );
      await expect(service.canAddTeamMember('team-1', 'user-2')).resolves.toBe(
        false,
      );
      await expect(service.canAddTeamMember('team-2', 'user-1')).resolves.toBe(
        false,
      );
    });

    it('propagates a Permify failure rather than answering', async () => {
      const failure = new Error('permify unavailable');
      permify.checkPermission.mockRejectedValue(failure);

      await expect(service.canAddTeamMember('team-1', 'user-1')).rejects.toBe(
        failure,
      );
    });
  });

  describe('propagation of Permify failures', () => {
    it('propagates the error raised by the single relations read', async () => {
      const failure = new Error('permify unavailable');
      permify.readRelationships.mockRejectedValue(failure);
      permify.checkPermission.mockRejectedValue(failure);

      await expect(
        service.teamAddMember({
          teamId: 'team-1',
          userId: 'user-1',
          role: 'developer',
        }),
      ).rejects.toBe(failure);
      expect(permify.writePermission).not.toHaveBeenCalled();
    });
  });
});

/**
 * The organisation's product attributes are seeded from the
 * edition's creation state (ENTITLEMENTS_PORT.organizationCreationState()),
 * in one write and with no read first: a new organisation has nothing to
 * read. A failure is the caller's to handle: organisation creation rolls
 * back on it.
 */
describe('AuthorizationService.initializeOrganizationProducts', () => {
  let service: AuthorizationService;
  let permify: {
    setOrganizationProductAttributes: jest.Mock;
    getOrganizationActive: jest.Mock;
    setOrganizationActive: jest.Mock;
  };

  beforeEach(async () => {
    permify = {
      setOrganizationProductAttributes: jest.fn().mockResolvedValue(true),
      getOrganizationActive: jest.fn(),
      setOrganizationActive: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PermifyService, useValue: permify },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('writes the given state mapped onto the four Permify attributes, in one write', async () => {
    // The Community Edition's creation state.
    await expect(
      service.initializeOrganizationProducts('o1', {
        isActive: true,
        writesBlocked: false,
        vibedefendActive: false,
        memberProducts: false,
      }),
    ).resolves.toBe(true);

    expect(permify.setOrganizationProductAttributes).toHaveBeenCalledTimes(1);
    expect(permify.setOrganizationProductAttributes).toHaveBeenCalledWith(
      'o1',
      {
        is_active: true,
        writes_blocked: false,
        vibedefend_active: false,
        member_products: false,
      },
    );
    expect(permify.getOrganizationActive).not.toHaveBeenCalled();
    expect(permify.setOrganizationActive).not.toHaveBeenCalled();
  });

  it('lets a Permify failure through, so the caller can roll the organisation back', async () => {
    const failure = new Error('permify down');
    permify.setOrganizationProductAttributes.mockRejectedValue(failure);

    await expect(
      service.initializeOrganizationProducts('o1', {
        isActive: true,
        writesBlocked: false,
        vibedefendActive: false,
        memberProducts: false,
      }),
    ).rejects.toBe(failure);
  });

  // A write Permify answers without a snap token was not applied: the
  // organisation would be kept without its attributes (is_active read as
  // false, no AppSec permission). It fails like a thrown error, so creation
  // rolls back.
  it('fails with INTERNAL when Permify answers the write without a snap token', async () => {
    permify.setOrganizationProductAttributes.mockResolvedValue(false);

    const result = service.initializeOrganizationProducts('o1', {
      isActive: true,
      writesBlocked: false,
      vibedefendActive: false,
      memberProducts: false,
    });

    await expect(result).rejects.toBeInstanceOf(RpcException);
    await expect(result).rejects.toMatchObject({
      error: expect.objectContaining({ code: status.INTERNAL }),
    });
  });
});

/**
 * A cloud organisation is created with no product. Its
 * three product attributes start false in Permify, written once, without the
 * read-before-write `setOrganizationActive` does: a new organisation has
 * nothing to read.
 */
describe('AuthorizationService.initializeOrganizationWithoutProduct', () => {
  let service: AuthorizationService;
  let permify: {
    setOrganizationProductAttributes: jest.Mock;
    getOrganizationActive: jest.Mock;
    setOrganizationActive: jest.Mock;
  };

  beforeEach(async () => {
    permify = {
      setOrganizationProductAttributes: jest.fn().mockResolvedValue(true),
      getOrganizationActive: jest.fn(),
      setOrganizationActive: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PermifyService, useValue: permify },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  // A new organisation has per-member products switched on at
  // creation, its switch written with the other attributes.
  it('writes the AppSec, write-block and second-product flags false, and member_products true, in one write', async () => {
    await expect(
      service.initializeOrganizationWithoutProduct('o1'),
    ).resolves.toBe(true);

    expect(permify.setOrganizationProductAttributes).toHaveBeenCalledTimes(1);
    expect(permify.setOrganizationProductAttributes).toHaveBeenCalledWith(
      'o1',
      {
        is_active: false,
        writes_blocked: false,
        vibedefend_active: false,
        member_products: true,
      },
    );
    expect(permify.getOrganizationActive).not.toHaveBeenCalled();
    expect(permify.setOrganizationActive).not.toHaveBeenCalled();
  });

  it('lets a Permify failure through, so the caller can roll the organisation back', async () => {
    const failure = new Error('permify down');
    permify.setOrganizationProductAttributes.mockRejectedValue(failure);

    await expect(
      service.initializeOrganizationWithoutProduct('o1'),
    ).rejects.toBe(failure);
  });

  it('fails with INTERNAL when Permify answers the write without a snap token', async () => {
    permify.setOrganizationProductAttributes.mockResolvedValue(false);

    await expect(
      service.initializeOrganizationWithoutProduct('o1'),
    ).rejects.toMatchObject({
      error: expect.objectContaining({ code: status.INTERNAL }),
    });
  });
});

/**
 * Per-member products (schema 1.5.0): global-management keeps a member's
 * `appsec_user` / `vibedefend_user` tuples in step with its product columns.
 * AuthorizationService is the only door to Permify the organisation code uses.
 */
describe('AuthorizationService: per-member products', () => {
  let service: AuthorizationService;
  let permify: {
    writeMemberProductTuples: jest.Mock;
    grantProductTuples: jest.Mock;
    setMemberProductsSwitch: jest.Mock;
  };

  beforeEach(async () => {
    permify = {
      writeMemberProductTuples: jest.fn().mockResolvedValue(undefined),
      grantProductTuples: jest.fn().mockResolvedValue(undefined),
      setMemberProductsSwitch: jest.fn().mockResolvedValue(true),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationService,
        { provide: PermifyService, useValue: permify },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();
    service = module.get(AuthorizationService);
  });

  it('setMemberProducts writes the tuples to match the products exactly', async () => {
    await service.setMemberProducts('o1', 'u1', ['vibedefend']);

    expect(permify.writeMemberProductTuples).toHaveBeenCalledWith('o1', 'u1', [
      'vibedefend',
    ]);
  });

  it('removeMemberProducts deletes both tuples', async () => {
    await service.removeMemberProducts('o1', 'u1');

    expect(permify.writeMemberProductTuples).toHaveBeenCalledWith(
      'o1',
      'u1',
      [],
    );
  });

  it('grantProductToMembers writes one product for many members', async () => {
    await service.grantProductToMembers('o1', 'appsec', ['u1', 'u2']);

    expect(permify.grantProductTuples).toHaveBeenCalledWith('o1', 'appsec', [
      'u1',
      'u2',
    ]);
  });

  it('setMemberProductsSwitch writes the attribute', async () => {
    await expect(service.setMemberProductsSwitch('o1', true)).resolves.toBe(
      true,
    );

    expect(permify.setMemberProductsSwitch).toHaveBeenCalledWith('o1', true);
  });

  it('lets a Permify failure through', async () => {
    const failure = new Error('permify down');
    permify.writeMemberProductTuples.mockRejectedValue(failure);

    await expect(
      service.setMemberProducts('o1', 'u1', ['appsec']),
    ).rejects.toBe(failure);
  });
});
