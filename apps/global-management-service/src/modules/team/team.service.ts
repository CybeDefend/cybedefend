// src/modules/team/team.service.ts

import { Injectable, Optional } from '@nestjs/common';
import { ulid } from 'ulid';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Team } from '../../entities/team.entity';
import { Organization } from '../../entities/organization.entity';
import { Project } from '../../entities/project.entity';
import { User } from '../../entities/user.entity';
import { UserTeamMembership } from '../../entities/user-team-membership.entity';
import { UserOrganizationMembership } from '../../entities/user-organization-membership.entity';

import {
  TeamGetRequest,
  TeamInformationsResponse,
  TeamGetAllRequest,
  TeamInformationsList,
  TeamCreateRequest,
  TeamCreateResponse,
  TeamUpdateRequest,
  TeamUpdateResponse,
  TeamDeleteRequest,
  TeamDeleteResponse,
  TeamAddMemberRequest,
  TeamAddMemberResponse,
  TeamRemoveUserRequest,
  TeamRemoveUserResponse,
  UpdateTeamRoleRequest,
  UpdateTeamRoleResponse,
  TeamGetMembersRequest,
  PaginatedUsersResponse,
  TeamGetMemberRequest,
} from '@grpc/global-management/team';
import { UserInformationsResponse } from '@grpc/global-management/user';

import { ProjectService } from '../project/project.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import {
  membersPageCount,
  readMembersPage,
} from '../organization/members-page';
import { isUniqueViolation } from '@cybedefend/db-dialect';
import {
  withMembershipLock,
  withMembershipLocks,
} from '../authorization/membership-lock';

/**
 * Whether `error` is the NOT_FOUND `AuthorizationService` throws for a user
 * who holds no role in the team any more: the tuple is already gone. It is an
 * in-process `RpcException`, never a gRPC client's `ServiceError`.
 */
function isNotFound(error: unknown): boolean {
  if (!(error instanceof RpcException)) return false;
  const details = error.getError();
  return (
    typeof details === 'object' &&
    details !== null &&
    (details as { code?: unknown }).code === status.NOT_FOUND
  );
}

/** The organisation roles that may demote or remove a team manager. */
const TEAM_MANAGER_OVERSEERS: ReadonlySet<string> = new Set([
  'creator',
  'administrator',
]);

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(Project)
    private readonly projRepo: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserTeamMembership)
    private readonly membershipRepo: Repository<UserTeamMembership>,
    private readonly logger: Logger,
    private readonly projectService: ProjectService,
    private readonly authorizationService: AuthorizationService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly purgeLedger: DataPurgeLedger,
    private readonly purgeRunner: DataPurgeRunner,
    @Optional() private readonly realtime?: RealtimeEventPublisher,
  ) {}

  /**
   * Whether `requesterId` may demote or remove a team manager of a team of
   * `organizationId`: the organisation's creator and its administrators may,
   * read from their membership of THAT organisation; another team manager,
   * anyone else, or no requester named (an older gateway) may not.
   */
  private async mayManageTeamManagers(
    organizationId: string | undefined,
    requesterId: string | undefined,
  ): Promise<boolean> {
    if (!organizationId || !requesterId) return false;
    const requester = await this.dataSource
      .getRepository(UserOrganizationMembership)
      .findOne({
        where: {
          organization: { id: organizationId },
          user: { id: requesterId },
        },
      });
    return TEAM_MANAGER_OVERSEERS.has(requester?.role);
  }

  @Span()
  async getTeam(request: TeamGetRequest): Promise<TeamInformationsResponse> {
    const team = await this.teamRepo.findOne({
      where: {
        id: request.teamId,
        organization: { id: request.organizationId },
      },
    });
    if (!team) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt ? team.createdAt.toISOString() : '',
      updatedAt: team.updatedAt ? team.updatedAt.toISOString() : '',
    };
  }

  @Span()
  async getAllTeams(request: TeamGetAllRequest): Promise<TeamInformationsList> {
    const { organizationId, userId } = request;

    // The privilege is one EXISTS on the caller's memberships;
    // every membership of the organization, with its user, used to be loaded
    // to answer it.
    const [organizationExists, privileged] = await Promise.all([
      this.orgRepo.exists({ where: { id: organizationId } }),
      this.orgRepo
        .createQueryBuilder('organization')
        .innerJoin('organization.userMemberships', 'membership')
        .where('organization.id = :organizationId', { organizationId })
        .andWhere('membership.userId = :userId', { userId })
        .andWhere('membership.role IN (:...privilegedRoles)', {
          privilegedRoles: ['creator', 'administrator'],
        })
        .getExists(),
    ]);
    if (!organizationExists) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }

    const query = this.teamRepo.createQueryBuilder('team');
    if (!privileged) query.innerJoin('team.userMemberships', 'membership');
    query.where('team.organizationId = :organizationId', { organizationId });
    if (!privileged) query.andWhere('membership.userId = :userId', { userId });
    // Explicit order (the previous reads had none): by name, the order of
    // IDX_team_org_name.
    const teams = await query
      .orderBy('team.name', 'ASC')
      .addOrderBy('team.id', 'ASC')
      .getMany();

    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        createdAt: t.createdAt ? t.createdAt.toISOString() : '',
        updatedAt: t.updatedAt ? t.updatedAt.toISOString() : '',
      })),
    };
  }

  @Span()
  async createTeam(request: TeamCreateRequest): Promise<TeamCreateResponse> {
    const { organizationId, name, description, creatorId } = request;

    if (
      await this.teamRepo.findOne({
        where: { name, organization: { id: organizationId } },
      })
    ) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'Team already exists in this organization',
      });
    }
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    }
    const count = await this.teamRepo.count({
      where: { organization: { id: organizationId } },
    });
    if (count >= 500) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Maximum number of teams reached',
      });
    }

    const team = this.teamRepo.create({ name, description, organization: org });
    if (creatorId) {
      const creator = await this.userRepo.findOne({ where: { id: creatorId } });
      if (!creator) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Creator user not found',
        });
      }
      team.creator = creator;
    } else {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Creator user not found',
      });
    }
    const saved = await this.teamRepo.save(team);

    this.logger.log(
      `Team ${saved.name} created with ID ${saved.id} in organization ${organizationId}`,
    );

    try {
      await this.authorizationService.addTeamInOrganization({
        organizationId,
        teamId: saved.id,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create IAM relation for team ${saved.name} with ID ${saved.id} : ${error}`,
      );
      await this.teamRepo.delete(saved.id);
      this.logger.log(
        `Team ${saved.name} with ID ${saved.id} deleted due to IAM relation failure during creation`,
      );
      throw error;
    }
    try {
      await this.authorizationService.teamAddMember({
        teamId: saved.id,
        userId: creatorId,
        role: 'team_manager',
      });
      this.logger.log(
        `IAM relation created for user ${creatorId} in team ${saved.name} with ID ${saved.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create IAM relation for user ${creatorId} in team ${saved.name} with ID ${saved.id} in organization ${organizationId} : ${error}`,
      );
      await this.teamRepo.delete(saved.id);
      this.logger.log(
        `Team ${saved.name} with ID ${saved.id} deleted due to IAM relation failure during creation`,
      );
      throw error;
    }

    await this.membershipRepo.save({
      team: saved,
      user: { id: creatorId } as User,
      role: 'team_manager',
    });

    return {
      message: 'Team created successfully',
      organizationId,
      teamId: saved.id,
      name: saved.name,
      description: saved.description,
    };
  }

  @Span()
  async updateTeam(request: TeamUpdateRequest): Promise<TeamUpdateResponse> {
    const team = await this.teamRepo.findOne({ where: { id: request.teamId } });
    if (!team) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }
    team.name = request.name;
    team.description = request.description;
    const updated = await this.teamRepo.save(team);
    return {
      message: 'Team updated successfully',
      updatedTeam: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        createdAt: updated.createdAt ? updated.createdAt.toISOString() : '',
        updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : '',
      },
    };
  }

  @Span()
  async deleteTeam(request: TeamDeleteRequest): Promise<TeamDeleteResponse> {
    const team = await this.teamRepo.findOne({
      where: { id: request.teamId },
      relations: ['organization', 'projects', 'userMemberships'],
    });
    if (!team) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }
    const orgTeams = await this.teamRepo.count({
      where: { organization: { id: team.organization.id } },
    });
    if (orgTeams <= 1) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Cannot delete the last team in an organization',
      });
    }

    for (const project of team.projects) {
      await this.projectService.deleteProject({
        projectId: project.id,
      });
    }

    try {
      await this.authorizationService.removeTeamFromOrganization({
        teamId: team.id,
        organizationId: team.organization.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to remove IAM relation for team ${team.id}`,
        err,
      );
      throw err;
    }

    // Each project above recorded its own job. The team's rows and the team
    // job (its scoped reports, their files, its policy targets) go together.
    const jobId = await this.dataSource.transaction(async (manager) => {
      await manager.delete(Team, team.id);
      await manager.delete(UserTeamMembership, { team: { id: team.id } });
      return this.purgeLedger.enqueueTeam(manager, {
        teamId: team.id,
        organizationId: team.organization.id,
      });
    });
    this.logger.log(
      `Team ${team.name} with ID ${team.id} deleted from organization ${team.organization.id} — purge job ${jobId} recorded`,
    );
    // After the commit, never inside it (see ProjectService.deleteProject).
    try {
      this.purgeRunner.kick([jobId]);
    } catch (err) {
      this.logger.warn(
        `DATA_PURGE_KICK_FAILED job=${jobId} error=${(err as Error)?.constructor?.name}`,
      );
    }
    return { message: 'Team deleted successfully' };
  }

  /**
   * Every add, role change and removal of one user in one team runs alone,
   * across replicas, the membership read again under the lock (see
   * withMembershipLock): two writes sent together could otherwise each read
   * the membership, then leave a second row or a second team role behind.
   */
  @Span()
  async addMember(
    request: TeamAddMemberRequest,
  ): Promise<TeamAddMemberResponse> {
    return withMembershipLock(
      this.dataSource,
      'team',
      request.teamId,
      request.userId,
      () => this.addMemberLocked(request),
    );
  }

  private async addMemberLocked(
    request: TeamAddMemberRequest,
  ): Promise<TeamAddMemberResponse> {
    const { teamId, userId, role } = request;
    const team = await this.teamRepo.findOne({
      where: { id: teamId },
      relations: ['organization'],
    });
    if (!team) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    if (
      await this.membershipRepo.findOne({
        where: { team: { id: teamId }, user: { id: userId } },
      })
    ) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'User is already a member of this team',
      });
    }

    const isMemberOfOrganization = await this.orgRepo
      .createQueryBuilder('organization')
      .innerJoin('organization.userMemberships', 'membership')
      .where('organization.id = :orgId', { orgId: team.organization.id })
      .andWhere('membership.user.id = :userId', { userId })
      .getCount();

    if (isMemberOfOrganization === 0) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'User is not a member of the organization',
      });
    }

    let savedMembership: UserTeamMembership;
    try {
      savedMembership = await this.membershipRepo.save({
        team,
        user,
        role,
      });
    } catch (error) {
      // The unique (teamId, userId) index: one row per member of a team.
      if (isUniqueViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'User is already a member of this team',
        });
      }
      throw error;
    }

    try {
      await this.authorizationService.teamAddMember({
        teamId,
        userId,
        role: savedMembership.role,
      });
    } catch (error) {
      this.logger.error(
        `Failed to create IAM relation for user ${userId} in team ${teamId}`,
        error,
      );
      await this.membershipRepo.delete(savedMembership.id);
      throw error;
    }

    void this.realtime?.publish({
      eventId: ulid(),
      type: 'MEMBERSHIP_CHANGED',
      scope: { organizationId: team.organization?.id, teamId, userId },
      payload: {
        membershipChanged: {
          userId,
          changeType: 'added',
          scopeType: 'team',
          scopeId: teamId,
        },
      },
    });
    return {
      message: 'User added to team successfully',
      updatedTeam: {
        id: team.id,
        name: team.name,
        description: team.description,
        createdAt: team.createdAt ? team.createdAt.toISOString() : '',
        updatedAt: team.updatedAt ? team.updatedAt.toISOString() : '',
      },
    };
  }

  @Span()
  async removeMember(
    request: TeamRemoveUserRequest,
  ): Promise<TeamRemoveUserResponse> {
    return withMembershipLock(
      this.dataSource,
      'team',
      request.teamId,
      request.userId,
      () => this.removeMemberLocked(request),
    );
  }

  private async removeMemberLocked(
    request: TeamRemoveUserRequest,
  ): Promise<TeamRemoveUserResponse> {
    const { teamId, userId } = request;
    const membership = await this.membershipRepo.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
      relations: ['team', 'team.organization', 'team.userMemberships'],
    });
    if (!membership) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Membership not found',
      });
    }
    if (membership.team.userMemberships.length <= 1) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Cannot remove the last user from a team',
      });
    }
    if (
      membership.role === 'team_manager' &&
      !(await this.mayManageTeamManagers(
        membership.team.organization?.id,
        request.removedBy,
      ))
    ) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Cannot remove a team manager',
      });
    }

    try {
      await this.authorizationService.removeMemberFromTeam({
        teamId,
        userId,
      });
      this.logger.log(
        `IAM relation removed for user ${userId} in team ${teamId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to remove IAM relation for user ${userId} in team ${teamId}`,
        error,
      );
      throw error;
    }

    await this.membershipRepo.remove(membership);
    void this.realtime?.publish({
      eventId: ulid(),
      type: 'MEMBERSHIP_CHANGED',
      scope: {
        organizationId: membership.team.organization?.id,
        teamId,
        userId,
      },
      payload: {
        membershipChanged: {
          userId,
          changeType: 'removed',
          scopeType: 'team',
          scopeId: teamId,
        },
      },
    });
    return { message: 'User removed from team successfully' };
  }

  /**
   * Force-remove a user from a team, bypassing the "last member" and
   * "team_manager" guards. Used exclusively when removing a member from
   * the entire organization — the user must leave every team regardless.
   */
  @Span()
  async forceRemoveMember(request: {
    teamId: string;
    userId: string;
  }): Promise<{ message: string }> {
    return withMembershipLock(
      this.dataSource,
      'team',
      request.teamId,
      request.userId,
      () => this.forceRemoveMemberLocked(request),
    );
  }

  private async forceRemoveMemberLocked(request: {
    teamId: string;
    userId: string;
  }): Promise<{ message: string }> {
    const { teamId, userId } = request;
    const membership = await this.membershipRepo.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
    });
    if (!membership) {
      // Already gone — nothing to do
      return { message: 'Membership already removed' };
    }

    // Clean Permify relation (best-effort: it may already be gone)
    try {
      await this.authorizationService.removeMemberFromTeam({
        teamId,
        userId,
      });
    } catch (error) {
      this.logger.warn(
        `forceRemoveMember: IAM relation cleanup failed for user ${userId} in team ${teamId} – proceeding with DB removal`,
        error,
      );
    }

    await this.membershipRepo.remove(membership);
    this.logger.log(
      `forceRemoveMember: user ${userId} removed from team ${teamId}`,
    );
    return { message: 'User force-removed from team successfully' };
  }

  /**
   * Force-remove a user from multiple teams in a single DB operation.
   * Bypasses "last member" and "team_manager" guards.
   * Used when removing a member from the entire organization.
   *
   * Every team tuple goes before any team row: a
   * tuple whose deletion fails answers UNAVAILABLE, the rows stay, and the
   * tuples this call already deleted are written back, so the rows and
   * Permify still agree and a retry removes them all. A tuple already gone
   * (NOT_FOUND) counts as deleted. Before, the rows were deleted whatever
   * Permify said, and a leftover tuple, shown nowhere, kept reading the
   * team's projects.
   */
  @Span()
  async forceRemoveMemberFromTeams(request: {
    userId: string;
    teamIds: string[];
  }): Promise<{ message: string; removedCount: number }> {
    const { userId, teamIds } = request;

    if (teamIds.length === 0) {
      return { message: 'No teams to remove user from', removedCount: 0 };
    }

    return withMembershipLocks(this.dataSource, 'team', teamIds, userId, () =>
      this.forceRemoveMemberFromTeamsLocked(userId, teamIds),
    );
  }

  private async forceRemoveMemberFromTeamsLocked(
    userId: string,
    teamIds: string[],
  ): Promise<{ message: string; removedCount: number }> {
    // Find all memberships for this user in the specified teams
    const memberships = await this.membershipRepo.find({
      where: {
        user: { id: userId },
        team: { id: In(teamIds) },
      },
      relations: ['team'],
    });

    if (memberships.length === 0) {
      return {
        message: 'User already removed from all teams',
        removedCount: 0,
      };
    }

    // Clean Permify relations in parallel; every one must go.
    const outcomes = await Promise.allSettled(
      memberships.map((m) =>
        this.authorizationService.removeMemberFromTeam({
          teamId: m.team.id,
          userId,
        }),
      ),
    );
    const failed = memberships.filter((_m, index) => {
      const outcome = outcomes[index];
      return outcome.status === 'rejected' && !isNotFound(outcome.reason);
    });
    if (failed.length > 0) {
      this.logger.error(
        `forceRemoveMemberFromTeams: team tuple of user ${userId} not deleted in team(s) ${failed
          .map((m) => m.team.id)
          .join(', ')}; no team row removed`,
      );
      // Put back what this call deleted: the rows stay, so must the tuples.
      const deleted = memberships.filter(
        (_m, index) => outcomes[index].status === 'fulfilled',
      );
      await Promise.allSettled(
        deleted.map((m) =>
          this.authorizationService
            .teamAddMember({ teamId: m.team.id, userId, role: m.role })
            .catch((restore: unknown) =>
              this.logger.error(
                `forceRemoveMemberFromTeams: team tuple of user ${userId} in team ${m.team.id} not written back: ${String(
                  (restore as Error)?.message ?? restore,
                )}`,
              ),
            ),
        ),
      );
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: 'Team access not removed, retry',
      });
    }

    // Remove all memberships in a single DB operation
    await this.membershipRepo.remove(memberships);

    this.logger.log(
      `forceRemoveMemberFromTeams: user ${userId} removed from ${memberships.length} teams`,
    );

    return {
      message: `User force-removed from ${memberships.length} teams successfully`,
      removedCount: memberships.length,
    };
  }

  @Span()
  async updateMemberRole(
    request: UpdateTeamRoleRequest,
  ): Promise<UpdateTeamRoleResponse> {
    return withMembershipLock(
      this.dataSource,
      'team',
      request.teamId,
      request.userId,
      () => this.updateMemberRoleLocked(request),
    );
  }

  private async updateMemberRoleLocked(
    request: UpdateTeamRoleRequest,
  ): Promise<UpdateTeamRoleResponse> {
    const { teamId, userId, role } = request;
    const membership = await this.membershipRepo.findOne({
      where: { team: { id: teamId }, user: { id: userId } },
      relations: ['team', 'team.organization', 'team.userMemberships'],
    });
    if (!membership) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Membership not found',
      });
    }
    if (
      membership.role === 'team_manager' &&
      !(await this.mayManageTeamManagers(
        membership.team.organization?.id,
        request.updatedBy,
      ))
    ) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Cannot modify a team manager role',
      });
    }

    try {
      await this.authorizationService.teamUpdateMemberRole({
        teamId,
        userId,
        role,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update IAM role for user ${userId} in team ${teamId}`,
        error,
      );
      throw error;
    }

    membership.role = role;
    await this.membershipRepo.save(membership);
    void this.realtime?.publish({
      eventId: ulid(),
      type: 'MEMBERSHIP_CHANGED',
      scope: {
        organizationId: membership.team.organization?.id,
        teamId,
        userId,
      },
      payload: {
        membershipChanged: {
          userId,
          changeType: 'role_changed',
          scopeType: 'team',
          scopeId: teamId,
        },
      },
    });
    return { message: 'User role updated successfully' };
  }

  @Span()
  async getMembers(
    request: TeamGetMembersRequest,
  ): Promise<PaginatedUsersResponse> {
    const { teamId, page = 1, pageSize = 15, searchQuery = '' } = request;

    // One page and its total in SQL, instead of every
    // membership and its user (see readMembersPage).
    const [memberships, totalUsers] = await readMembersPage(
      this.membershipRepo
        .createQueryBuilder('membership')
        .leftJoinAndSelect('membership.user', 'user')
        .where('membership.teamId = :teamId', { teamId }),
      { page, pageSize, searchQuery },
    );
    // An empty team exists; only an empty answer may come from an unknown one.
    if (
      totalUsers === 0 &&
      !(await this.teamRepo.exists({ where: { id: teamId } }))
    ) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }

    const users: UserInformationsResponse[] = memberships.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      picture: m.user.picture,
      role: m.role,
    }));

    return {
      users,
      totalUsers,
      totalPages: membersPageCount(totalUsers, pageSize),
    };
  }

  @Span()
  async getMember(
    request: TeamGetMemberRequest,
  ): Promise<UserInformationsResponse> {
    const { teamId, userId } = request;
    // The one membership, with its user, instead of every
    // membership of the team. If the user holds two, the one with the lowest
    // membership id wins.
    const m = await this.membershipRepo
      .createQueryBuilder('membership')
      .innerJoinAndSelect('membership.user', 'user')
      .where('membership.teamId = :teamId', { teamId })
      .andWhere('membership.userId = :userId', { userId })
      .orderBy('membership.id', 'ASC')
      .getOne();
    if (!m) {
      const teamExists = await this.teamRepo.exists({ where: { id: teamId } });
      throw new RpcException({
        code: status.NOT_FOUND,
        message: teamExists ? 'User not in team' : 'Team not found',
      });
    }
    return {
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      picture: m.user.picture,
      role: m.role,
    };
  }

  /**
   * Validate that multiple teams belong to an organization in a single SQL query.
   * Used by policy-management-service for efficient validation.
   */
  @Span()
  async validateTeamsInOrganization(data: {
    teamIds: string[];
    organizationId: string;
  }): Promise<{
    valid: boolean;
    notFoundIds: string[];
  }> {
    const { teamIds, organizationId } = data;

    // Handle empty array case
    if (!teamIds || teamIds.length === 0) {
      return { valid: true, notFoundIds: [] };
    }

    // Single SQL query to find all teams by IDs that belong to the organization
    const teams = await this.teamRepo
      .createQueryBuilder('team')
      .where('team.id IN (:...teamIds)', { teamIds })
      .andWhere('team.organizationId = :organizationId', { organizationId })
      .select(['team.id'])
      .getMany();

    const foundIds = new Set(teams.map((t) => t.id));
    const notFoundIds = teamIds.filter((id) => !foundIds.has(id));

    return {
      valid: notFoundIds.length === 0,
      notFoundIds,
    };
  }
}
