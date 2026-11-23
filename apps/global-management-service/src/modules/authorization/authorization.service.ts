import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { MemberProduct, PermifyService } from '../permify/permify.service';
import type { OrganizationCreationState } from 'src/edition/ports/entitlements.port';

/**
 * Membership relations a user can hold on an organization, in the order the
 * historical loop of `check` calls probed them — the order still decides which
 * one is acted upon when a user holds several. `creator` is deliberately
 * absent: it was never probed, so it never blocks an add and is never deleted.
 */
const ORGANIZATION_ROLES = [
  'administrator',
  'manager',
  'billing_manager',
  'member',
];

/** Membership relations a user can hold on a team, in probing order. */
const TEAM_ROLES = [
  'team_manager',
  'analyst_developer',
  'developer',
  'read_only',
];

/**
 * AuthorizationService — local Permify integration for Global Management Service.
 *
 * Organization/team/project permission operations are local method calls;
 * none is served over gRPC (billing writes `is_active` to Permify itself).
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly permifyService: PermifyService,
    private readonly logger: Logger,
  ) {}

  /**
   * Which of `candidates` the subject actually holds on the entity, in
   * candidate order — ONE Permify RPC.
   *
   * Replaces the loops of up to four `checkPermission` calls: the membership
   * relations are all direct `@user` relations, so "check allowed" and "the
   * tuple exists" are the same thing. Relations outside `candidates` (e.g.
   * `organization#creator`) are filtered out, exactly as the loops ignored
   * them.
   */
  private async readHeldRoles(
    entityType: string,
    entityId: string,
    subjectId: string,
    candidates: string[],
    subjectType = 'user',
  ): Promise<string[]> {
    const relations = await this.permifyService.readRelationships({
      entity: { type: entityType, id: entityId },
      subject: { type: subjectType, id: subjectId },
    });
    const held = new Set(relations);

    return candidates.filter((candidate) => held.has(candidate));
  }

  /**
   * Update role of a user in an organization
   */
  @Span()
  async updateOrganizationRole(data: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<{ message: string }> {
    const [currentRole] = await this.readHeldRoles(
      'organization',
      data.organizationId,
      data.userId,
      ORGANIZATION_ROLES,
    );

    if (!currentRole) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User does not have any role in organization`,
      });
    }

    if (currentRole === data.role) {
      return {
        message: `User ${data.userId} already has role ${data.role} in organization ${data.organizationId}`,
      };
    }

    await this.permifyService.deletePermission(
      data.organizationId,
      data.userId,
      'user',
      'organization',
      currentRole,
    );

    await this.permifyService.writePermission(
      data.organizationId,
      data.userId,
      'user',
      'organization',
      data.role,
    );

    return {
      message: `User ${data.userId} role updated to ${data.role} in organization ${data.organizationId}`,
    };
  }

  /**
   * Add team to an organization
   */
  @Span()
  async addTeamInOrganization(data: {
    teamId: string;
    organizationId: string;
  }): Promise<{ message: string }> {
    if (
      await this.permifyService.checkPermission(
        data.teamId,
        data.organizationId,
        'organization',
        'team',
        'organization',
      )
    ) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `Team already in organization`,
      });
    }

    await this.permifyService.writePermission(
      data.teamId,
      data.organizationId,
      'organization',
      'team',
      'organization',
    );

    this.logger.log(
      `Team ${data.teamId} added to organization ${data.organizationId}`,
    );
    return {
      message: `Team ${data.teamId} added to organization ${data.organizationId}`,
    };
  }

  /**
   * Remove member from an organization
   */
  @Span()
  async organizationRemoveMember(data: {
    organizationId: string;
    userId: string;
  }): Promise<{ message: string }> {
    // Delete ALL matching roles — not just the first one.
    // A user may have stale/duplicate Permify relations.
    const heldRoles = await this.readHeldRoles(
      'organization',
      data.organizationId,
      data.userId,
      ORGANIZATION_ROLES,
    );

    for (const role of heldRoles) {
      await this.permifyService.deletePermission(
        data.organizationId,
        data.userId,
        'user',
        'organization',
        role,
      );
      this.logger.log(
        `Deleted Permify relation '${role}' for user ${data.userId} in org ${data.organizationId}`,
      );
    }

    if (heldRoles.length === 0) {
      this.logger.warn(
        `No Permify roles found for user ${data.userId} in org ${data.organizationId} — proceeding anyway`,
      );
    }

    return {
      message: `User ${data.userId} removed from organization ${data.organizationId}`,
    };
  }

  /**
   * Remove organization — delete all team, project, and org permissions
   */
  @Span()
  async removeOrganization(data: {
    organizationId: string;
    teamIds: string[];
    projectIds: string[];
  }): Promise<{ message: string }> {
    for (const teamId of data.teamIds) {
      const successTeam = await this.permifyService.deleteAllPermissions(
        teamId,
        'team',
      );

      if (!successTeam) {
        this.logger.error(
          `Error removing team ${teamId} from organization ${data.organizationId}`,
        );
        throw new RpcException({
          code: status.INTERNAL,
          message: `Error removing team`,
        });
      }
    }

    for (const projectId of data.projectIds) {
      const successProject = await this.permifyService.deleteAllPermissions(
        projectId,
        'project',
      );

      if (!successProject) {
        this.logger.error(
          `Error removing project ${projectId} from organization ${data.organizationId}`,
        );
        throw new RpcException({
          code: status.INTERNAL,
          message: `Error removing project`,
        });
      }
    }

    await this.permifyService.deleteAllPermissions(
      data.organizationId,
      'organization',
    );

    this.logger.log(
      `Organization ${data.organizationId} removed with teams ${data.teamIds} and projects ${data.projectIds}`,
    );

    return { message: `Organization ${data.organizationId} removed` };
  }

  /**
   * Add member to an organization
   */
  @Span()
  async organizationAddMember(data: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<{ message: string; userId: string }> {
    const heldRoles = await this.readHeldRoles(
      'organization',
      data.organizationId,
      data.userId,
      ORGANIZATION_ROLES,
    );

    if (heldRoles.length > 0) {
      this.logger.warn(
        `User ${data.userId} already has a role in organization ${data.organizationId}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `User already has a role in organization`,
      });
    }

    await this.permifyService.writePermission(
      data.organizationId,
      data.userId,
      'user',
      'organization',
      data.role,
    );

    this.logger.log(
      `User ${data.userId} added to organization ${data.organizationId} with role ${data.role}`,
    );
    return {
      message: `User ${data.userId} added to organization ${data.organizationId} with role ${data.role}`,
      userId: data.userId,
    };
  }

  /**
   * Set organization active/inactive state in Permify
   */
  @Span()
  async setOrganizationActive(
    organizationId: string,
    active: boolean,
  ): Promise<boolean> {
    // Check current state to avoid unnecessary writes
    try {
      const currentState =
        await this.permifyService.getOrganizationActive(organizationId);

      if (currentState === active) {
        this.logger.log(
          `Organization ${organizationId} is already ${active ? 'active' : 'inactive'}, skipping write to Permify`,
        );
        return true;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to check current organization state for ${organizationId}, proceeding with write: ${error}`,
      );
    }

    const ok = await this.permifyService.setOrganizationActive(
      organizationId,
      active,
    );
    this.logger.log(
      `Set organization ${organizationId} active=${active} -> ${ok}`,
    );
    return ok;
  }

  /**
   * Seed the organisation's product attributes by edition, in ONE
   * write and with no read first (a new organisation has nothing to read):
   * `is_active` and `writes_blocked` are AppSec's, `vibedefend_active` is
   * the second product's, `member_products` is the per-member products switch. The
   * state comes from ENTITLEMENTS_PORT.organizationCreationState() —
   * true/false/false/false in the Community Edition, false/false/false/true in
   * the cloud. A failure, a write Permify answers without a snap token
   * included (INTERNAL), is the caller's to handle: organisation creation
   * rolls back on it.
   */
  @Span()
  async initializeOrganizationProducts(
    organizationId: string,
    state: OrganizationCreationState,
  ): Promise<boolean> {
    const ok = await this.permifyService.setOrganizationProductAttributes(
      organizationId,
      {
        is_active: state.isActive,
        writes_blocked: state.writesBlocked,
        vibedefend_active: state.vibedefendActive,
        member_products: state.memberProducts,
      },
    );
    this.logger.log(
      `Organization ${organizationId} product attributes seeded in Permify -> ${ok}`,
    );
    if (!ok) {
      // A write answered without a snap token was not applied: the
      // organisation would be kept without its attributes (`is_active` read
      // as false). It fails like a write that threw, so creation rolls back.
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error while setting organization product attributes',
      });
    }
    return ok;
  }

  /**
   * A new cloud organisation has no product: its three product attributes
   * start false and `member_products` starts true, in one write.
   * Cloud-valued wrapper of initializeOrganizationProducts, kept for the
   * callers that seed the cloud state explicitly.
   */
  @Span()
  async initializeOrganizationWithoutProduct(
    organizationId: string,
  ): Promise<boolean> {
    return this.initializeOrganizationProducts(organizationId, {
      isActive: false,
      writesBlocked: false,
      vibedefendActive: false,
      memberProducts: true,
    });
  }

  /**
   * Per-member products (schema 1.5.0): the member's `appsec_user` /
   * `vibedefend_user` tuples, made to match `products` exactly.
   */
  @Span()
  async setMemberProducts(
    organizationId: string,
    userId: string,
    products: readonly MemberProduct[],
  ): Promise<void> {
    await this.permifyService.writeMemberProductTuples(
      organizationId,
      userId,
      products,
    );
  }

  /** Both product tuples of a member deleted (the member leaves). */
  @Span()
  async removeMemberProducts(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    await this.permifyService.writeMemberProductTuples(
      organizationId,
      userId,
      [],
    );
  }

  /** One product's tuple written for each of `userIds` (an activation). */
  @Span()
  async grantProductToMembers(
    organizationId: string,
    product: MemberProduct,
    userIds: readonly string[],
  ): Promise<void> {
    await this.permifyService.grantProductTuples(
      organizationId,
      product,
      userIds,
    );
  }

  /** The organisation's `member_products` attribute. */
  @Span()
  async setMemberProductsSwitch(
    organizationId: string,
    on: boolean,
  ): Promise<boolean> {
    return this.permifyService.setMemberProductsSwitch(organizationId, on);
  }

  /**
   * Add member to a team
   */
  @Span()
  async teamAddMember(data: {
    teamId: string;
    userId: string;
    role: string;
  }): Promise<{ message: string }> {
    const heldRoles = await this.readHeldRoles(
      'team',
      data.teamId,
      data.userId,
      TEAM_ROLES,
    );

    if (heldRoles.length > 0) {
      this.logger.warn(
        `User ${data.userId} already has a role in team ${data.teamId}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `User already has a role in team`,
      });
    }

    await this.permifyService.writePermission(
      data.teamId,
      data.userId,
      'user',
      'team',
      data.role,
    );

    this.logger.log(
      `User ${data.userId} added to team ${data.teamId} with role ${data.role}`,
    );

    return {
      message: `User ${data.userId} added to team ${data.teamId} with role ${data.role}`,
    };
  }

  /**
   * Whether the user may seat someone in the team: the `team#add_user`
   * permission, the very check the gateway runs on POST /team/:teamId/member.
   * An invitation's team seats must pass it too: an org `manager`
   * holds `organization#add_user` but no permission on any team.
   *
   * A permission `check`, never a relation read — org creators and
   * administrators hold it through the graph, without any team tuple.
   */
  @Span()
  async canAddTeamMember(teamId: string, userId: string): Promise<boolean> {
    return this.permifyService.checkPermission(
      teamId,
      userId,
      'user',
      'team',
      'add_user',
    );
  }

  /**
   * Update role of a member in a team
   */
  @Span()
  async teamUpdateMemberRole(data: {
    teamId: string;
    userId: string;
    role: string;
  }): Promise<{ message: string }> {
    const [currentRole] = await this.readHeldRoles(
      'team',
      data.teamId,
      data.userId,
      TEAM_ROLES,
    );

    if (!currentRole) {
      this.logger.warn(
        `User ${data.userId} does not have any role in team ${data.teamId}`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User does not have any role in team`,
      });
    }

    if (currentRole === data.role) {
      this.logger.log(
        `User ${data.userId} already has role ${data.role} in team ${data.teamId}`,
      );
      return {
        message: `User ${data.userId} already has role ${data.role} in team ${data.teamId}`,
      };
    }

    await this.permifyService.deletePermission(
      data.teamId,
      data.userId,
      'user',
      'team',
      currentRole,
    );

    await this.permifyService.writePermission(
      data.teamId,
      data.userId,
      'user',
      'team',
      data.role,
    );

    this.logger.log(
      `User ${data.userId} role updated to ${data.role} in team ${data.teamId}`,
    );
    return {
      message: `User ${data.userId} role updated to ${data.role} in team ${data.teamId}`,
    };
  }

  /**
   * Remove member from a team
   */
  @Span()
  async removeMemberFromTeam(data: {
    teamId: string;
    userId: string;
  }): Promise<{ message: string }> {
    // Unlike `organizationRemoveMember`, only the first held role is deleted —
    // pre-existing behaviour, preserved as is.
    const [currentRole] = await this.readHeldRoles(
      'team',
      data.teamId,
      data.userId,
      TEAM_ROLES,
    );

    if (!currentRole) {
      this.logger.warn(
        `Cannot remove user ${data.userId} from team ${data.teamId} because it is not related to the team`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User does not have any role in team`,
      });
    }

    await this.permifyService.deletePermission(
      data.teamId,
      data.userId,
      'user',
      'team',
      currentRole,
    );

    this.logger.log(`User ${data.userId} removed from team ${data.teamId}`);
    return {
      message: `User ${data.userId} removed from team ${data.teamId}`,
    };
  }

  /**
   * Remove team from an organization
   */
  @Span()
  async removeTeamFromOrganization(data: {
    teamId: string;
    organizationId: string;
  }): Promise<{ message: string }> {
    await this.permifyService.deleteAllPermissions(data.teamId, 'team');

    this.logger.log(
      `Team ${data.teamId} removed from organization ${data.organizationId}`,
    );
    return {
      message: `Team ${data.teamId} removed from organization ${data.organizationId}`,
    };
  }

  /**
   * Add project to a team (+ organization relation)
   */
  @Span()
  async addProjectRelation(data: {
    projectId: string;
    teamId: string;
    organizationId: string;
  }): Promise<{ message: string }> {
    if (
      await this.permifyService.checkPermission(
        data.projectId,
        data.teamId,
        'team',
        'project',
        'team',
      )
    ) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `Team already in project`,
      });
    }

    await this.permifyService.writePermission(
      data.projectId,
      data.teamId,
      'team',
      'project',
      'team',
    );

    this.logger.log(`Project ${data.projectId} added to team ${data.teamId}`);

    if (
      await this.permifyService.checkPermission(
        data.projectId,
        data.organizationId,
        'organization',
        'project',
        'organization',
      )
    ) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: `Project already in organization`,
      });
    }

    await this.permifyService.writePermission(
      data.projectId,
      data.organizationId,
      'organization',
      'project',
      'organization',
    );

    this.logger.log(
      `Project ${data.projectId} added to organization ${data.organizationId}`,
    );
    return {
      message: `Project ${data.projectId} added to team ${data.teamId} and organization ${data.organizationId}`,
    };
  }

  /**
   * Remove project from a team
   */
  @Span()
  async removeProjectFromTeam(data: {
    projectId: string;
    teamId: string;
    organizationId: string;
  }): Promise<{ message: string }> {
    if (
      await this.permifyService.checkPermission(
        data.projectId,
        data.teamId,
        'team',
        'project',
        'team',
      )
    ) {
      await this.permifyService.deletePermission(
        data.projectId,
        data.teamId,
        'team',
        'project',
        'team',
      );

      if (
        await this.permifyService.checkPermission(
          data.projectId,
          data.organizationId,
          'organization',
          'project',
          'organization',
        )
      ) {
        await this.permifyService.deletePermission(
          data.projectId,
          data.organizationId,
          'organization',
          'project',
          'organization',
        );
      }

      this.logger.log(
        `Project ${data.projectId} removed from team ${data.teamId}`,
      );
      return {
        message: `Project ${data.projectId} removed from team ${data.teamId}`,
      };
    } else {
      this.logger.warn(
        `Cannot remove project ${data.projectId} from team ${data.teamId} because it is not related to the team`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Team not in project`,
      });
    }
  }
}
