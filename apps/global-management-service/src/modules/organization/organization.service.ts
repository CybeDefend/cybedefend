import { Inject, Injectable, Optional } from '@nestjs/common';
import { ulid } from 'ulid';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Span } from 'nestjs-otel';
import { tokenHash } from 'src/modules/local-auth/token-hash';
import { Logger } from 'nestjs-pino';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { User } from 'src/entities/user.entity';
import { MailService } from 'src/modules/mail/mail.service';
import {
  IDENTITY_PROVIDER_PORT,
  IdentityProviderPort,
} from 'src/edition/ports/identity-provider.port';
import {
  ENTITLEMENTS_PORT,
  GlobalManagementEntitlementsPort,
} from 'src/edition/ports/entitlements.port';
import {
  ORGANIZATION_LIFECYCLE_HOOKS,
  OrganizationLifecycleHooks,
} from 'src/edition/ports/organization-lifecycle.port';
import {
  MEMBER_PRODUCTS_PORT,
  MemberGrant,
  MemberProductsPort,
} from 'src/edition/ports/member-products.port';
import { DataSource, In, IsNull, MoreThan, Repository } from 'typeorm';
import { OrganizationInvitation } from '../../entities/organization-invitation.entity';
import { Organization } from '../../entities/organization.entity';
import { TeamService } from '../team/team.service';
import { TeamCreateRequest } from '@grpc/global-management/team';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { normalizeEmail } from 'src/core/db/normalize-email';
import { isCommunityEdition } from 'src/edition/edition';
import {
  GetOrganizationInvitationsResponse,
  OrganizationAcceptInviteRequest,
  OrganizationAcceptInviteResponse,
  OrganizationCancelRequest,
  OrganizationCreateRequest,
  OrganizationCreateResponse,
  OrganizationDeleteMemberRequest,
  OrganizationDeleteMemberResponse,
  OrganizationDeleteRequest,
  OrganizationDeleteResponse,
  OrganizationGetAllRequest,
  OrganizationGetIdByProjectIdResponse,
  OrganizationGetIdByTeamIdResponse,
  OrganizationGetInvitationsRequest,
  OrganizationGetMembersRequest,
  OrganizationGetRequest,
  OrganizationInformationsResponse,
  OrganizationInviteRequest,
  OrganizationInviteResponse,
  OrganizationUpdateRequest,
  OrganizationUpdateResponse,
  OrganizationUpdateRoleRequest,
  OrganizationUpdateRoleResponse,
  CancelAllPendingInvitationsRequest,
  CancelAllPendingInvitationsResponse,
  CountMembersInOrganizationResponse,
  PaginatedOrganizationMembersResponse,
  RequestOrganizationDeletionCodeRequest,
  RequestOrganizationDeletionCodeResponse,
  ConfirmOrganizationDeletionRequest,
} from '@grpc/global-management/organization';
import { AuthorizationService } from '../authorization/authorization.service';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { OrganizationDeletionCodeService } from './organization-deletion-code.service';
import { organizationDeletionRefusal } from './organization-deletion-code';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { findProjectWithTeamOrg } from '../project/find-project-with-team-org';
import {
  ORGANIZATION_PROFILE_PORT,
  OrganizationProfilePort,
} from 'src/edition/ports/organization-profile.port';
import { membersPageCount, readMembersPage } from './members-page';
import { withMembershipLock } from '../authorization/membership-lock';
import {
  INVITATION_LIMIT_WINDOW_MS,
  invitationLimits,
} from './invitation-limits';
import { isUniqueViolation } from '@cybedefend/db-dialect';

/**
 * Organization roles an inviter may confer, by the inviter's own role. A role is listed only when every permission it carries in
 * `schema.perm` is one the inviter already holds, so an invitation never mints
 * more power than its author has: a manager holds no `billing`, hence cannot
 * invite a billing_manager. Administrators are appointed by the creator only,
 * a manager invites members only, and nobody invites a
 * second creator. Any other inviter role, or no
 * membership at all, confers nothing.
 */
const INVITABLE_ORGANIZATION_ROLES = new Map<string, readonly string[]>([
  ['creator', ['administrator', 'manager', 'billing_manager', 'member']],
  ['administrator', ['manager', 'billing_manager', 'member']],
  ['manager', ['member']],
]);

/**
 * An invitation consumed by an acceptance that never seated the member: its
 * status turned `accepted` first and `acceptedAt` is written only once the
 * member is seated. The next acceptance by the same invitee completes it.
 * An invitation accepted before this rule existed always has `acceptedAt`.
 */
function isConsumedNotSeated(invitation: OrganizationInvitation): boolean {
  return invitation.status === 'accepted' && !invitation.acceptedAt;
}

/** At most this many team seats in one invitation. */
export const MAX_INVITATION_TEAM_ASSIGNMENTS = 50;

/** Whether an inviter holding `inviterRole` may confer `role` (see above). */
function mayInvite(inviterRole: string | undefined, role: string): boolean {
  return (INVITABLE_ORGANIZATION_ROLES.get(inviterRole) ?? []).includes(role);
}

/**
 * The roles the Community Edition gives nobody: billing belongs to the closed
 * edition, so no `billing_manager`. Refused by invitation and by role
 * change with `ROLE_NOT_AVAILABLE`; a member who already holds it keeps it.
 */
const COMMUNITY_UNAVAILABLE_ROLES: ReadonlySet<string> = new Set([
  'billing_manager',
]);

function assertRoleAvailable(role: string): void {
  if (isCommunityEdition() && COMMUNITY_UNAVAILABLE_ROLES.has(role)) {
    // The code as the message: the gateway answers it as `body.code`.
    throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message: 'ROLE_NOT_AVAILABLE',
    });
  }
}

/**
 * Every organisation role anyone may give, by invitation or by a role change:
 * never `creator`, never a role outside the schema.
 */
const ASSIGNABLE_ORGANIZATION_ROLES: ReadonlySet<string> = new Set(
  [...INVITABLE_ORGANIZATION_ROLES.values()].flat(),
);

@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly logger: Logger,
    @InjectRepository(UserOrganizationMembership)
    private readonly userOrganizationMembershipRepository: Repository<UserOrganizationMembership>,
    @InjectRepository(UserTeamMembership)
    private readonly userTeamMembershipRepository: Repository<UserTeamMembership>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(OrganizationInvitation)
    private readonly organizationInvitationRepository: Repository<OrganizationInvitation>,
    private readonly mailService: MailService,
    private readonly teamService: TeamService,
    private readonly authorizationService: AuthorizationService,
    @Inject(IDENTITY_PROVIDER_PORT)
    private readonly identity: IdentityProviderPort,
    private readonly purgeLedger: DataPurgeLedger,
    private readonly purgeRunner: DataPurgeRunner,
    private readonly deletionCodes: OrganizationDeletionCodeService,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: GlobalManagementEntitlementsPort,
    @Inject(ORGANIZATION_LIFECYCLE_HOOKS)
    private readonly lifecycleHooks: OrganizationLifecycleHooks,
    @Inject(MEMBER_PRODUCTS_PORT)
    private readonly memberProducts: MemberProductsPort,
    @Inject(ORGANIZATION_PROFILE_PORT)
    private readonly organizationProfile: OrganizationProfilePort,
    @Optional() private readonly realtime?: RealtimeEventPublisher,
  ) {}

  /**
   * Invite a user to an organization
   *
   * @param request - The invitation data
   * @returns The invitation response
   */
  @Span()
  async inviteUserToOrganization(
    request: OrganizationInviteRequest,
  ): Promise<OrganizationInviteResponse> {
    assertRoleAvailable(request.role);
    const organization = await this.organizationRepository.findOne({
      where: { id: request.organizationId },
    });

    if (!organization) {
      this.logger.warn(
        `Organization with ID ${request.organizationId} not found`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Organization not found`,
      });
    }

    const invitedByUser = await this.userRepository.findOne({
      where: { id: request.invitedBy },
    });

    if (!invitedByUser) {
      this.logger.warn(`User that created the invitation not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    const organizationMembership =
      await this.userOrganizationMembershipRepository.findOne({
        where: {
          user: { id: request.invitedBy },
          organization: { id: request.organizationId },
        },
      });

    if (!mayInvite(organizationMembership?.role, request.role)) {
      this.logger.warn(
        `User ${request.invitedBy} (role ${organizationMembership?.role ?? 'none'}) may not invite a ${request.role} into organization ${request.organizationId}`,
      );
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'User not allowed to invite with this role',
      });
    }

    const existingMembership =
      await this.userOrganizationMembershipRepository.findOne({
        where: {
          user: { email: normalizeEmail(request.email) },
          organization: { id: organization.id },
        },
      });

    if (existingMembership) {
      this.logger.warn(
        `Invitation refused: the invited user is already a member of organization ${organization.id}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'User is already a member of the organization',
      });
    }

    // Each team seat is granted one after the other at acceptance: bounded.
    if (
      (request.teamAssignments?.length ?? 0) > MAX_INVITATION_TEAM_ASSIGNMENTS
    ) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `An invitation seats the member in at most ${MAX_INVITATION_TEAM_ASSIGNMENTS} teams`,
      });
    }

    // Validate team assignments if provided
    if (request.teamAssignments && request.teamAssignments.length > 0) {
      const teamIds = request.teamAssignments.map(
        (assignment) => assignment.teamId,
      );
      const teams = await this.teamRepository.find({
        where: {
          id: In(teamIds),
          organization: { id: organization.id },
        },
      });

      if (teams.length !== teamIds.length) {
        const foundTeamIds = teams.map((team) => team.id);
        const invalidTeamIds = teamIds.filter(
          (id) => !foundTeamIds.includes(id),
        );
        this.logger.warn(
          `Invalid team IDs provided: ${invalidTeamIds.join(', ')} for organization ${organization.id}`,
        );
        throw new RpcException({
          code: status.INVALID_ARGUMENT,
          message: `Some teams do not exist or do not belong to this organization`,
        });
      }

      // Validate team roles
      const validTeamRoles = [
        'team_manager',
        'analyst_developer',
        'developer',
        'read_only',
      ];
      for (const assignment of request.teamAssignments) {
        if (!validTeamRoles.includes(assignment.role)) {
          this.logger.warn(
            `Invalid team role provided: ${assignment.role} for team ${assignment.teamId}`,
          );
          throw new RpcException({
            code: status.INVALID_ARGUMENT,
            message: `Invalid team role`,
          });
        }
      }

      // The gateway only checks `organization#add_user`. Each seat must pass
      // what POST /team/:teamId/member would require of the inviter.
      for (const teamId of teamIds) {
        if (
          !(await this.authorizationService.canAddTeamMember(
            teamId,
            request.invitedBy,
          ))
        ) {
          this.logger.warn(
            `User ${request.invitedBy} may not add members to team ${teamId} of organization ${organization.id}; invitation refused`,
          );
          throw new RpcException({
            code: status.PERMISSION_DENIED,
            message:
              'User not allowed to add members to one or more of the selected teams',
          });
        }
      }

      this.logger.log(
        `Validated ${teams.length} team assignments for invitation: ${request.teamAssignments.map((a) => `${a.teamId}:${a.role}`).join(', ')}`,
      );
    }

    // What the invitation gives beyond its role, as the edition decides it
    // (nothing in the Community Edition); it may refuse.
    const grant = await this.memberProducts.resolveInvitation(
      request,
      organization,
      organizationMembership,
    );

    // Seat check and insert, serialized per organization.
    // Count, ask billing, insert was a check-then-act race: K parallel
    // invitations at 9 members for 10 seats each counted 9 + 0 + 1 = 10, all
    // passed, and all K were inserted. As createProject does for the project
    // limit, the whole sequence runs on one transaction whose first statement
    // locks the organization row: a concurrent invitation to the same
    // organization waits until this one has committed or rolled back, then
    // counts what it inserted.
    //
    // Inside the callback only `manager` touches the database. A repository
    // call would run on ANOTHER pooled connection: with N invitations holding
    // connections while they wait on the lock, the lock holder could starve
    // the pool.
    const { saved: organizationInvitation, token: invitationToken } =
      await this.dataSource.transaction(async (manager) => {
        // 1. SELECT … FOR UPDATE on the organization row. It MUST be the
        //    first read of the transaction: under MySQL's REPEATABLE READ,
        //    the snapshot that the plain SELECTs below read from is created
        //    at the first of them, not at the locking read. Creating it after
        //    the lock is what makes a transaction that waited here see the
        //    invitation committed by the previous lock holder; a snapshot
        //    taken before the wait would still miss it.
        const lockedOrganization = await manager.findOne(Organization, {
          where: { id: organization.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!lockedOrganization) {
          throw new RpcException({
            code: status.NOT_FOUND,
            message: 'Organization not found',
          });
        }

        // 2. The seat the invitation takes, decided by the edition on this
        //    transaction while the lock is held (none in the Community
        //    Edition).
        await this.memberProducts.assertInvitationSeat(
          manager,
          organization.id,
          lockedOrganization,
          grant,
        );

        // 2b. How many invitations this organisation, and this inviter,
        //     created over the last 24 hours, whatever became of them: an
        //     invitation canceled right after it was sent still sent an
        //     e-mail. Counted under the organisation lock, so parallel
        //     invitations to one organisation cannot all pass it.
        const limits = invitationLimits();
        const since = new Date(Date.now() - INVITATION_LIMIT_WINDOW_MS);
        const byOrganization = await manager.count(OrganizationInvitation, {
          where: {
            organization: { id: organization.id },
            createdAt: MoreThan(since),
          },
        });
        const byInviter = await manager.count(OrganizationInvitation, {
          where: {
            invitedBy: { id: invitedByUser.id },
            createdAt: MoreThan(since),
          },
        });
        // Canceled over the window (the cancellation is the row's last
        // update): the invite-then-cancel loop.
        const canceled = await manager.count(OrganizationInvitation, {
          where: {
            organization: { id: organization.id },
            status: 'canceled',
            updatedAt: MoreThan(since),
          },
        });
        if (
          byOrganization >= limits.perOrganization ||
          byInviter >= limits.perInviter ||
          canceled >= limits.canceledPerOrganization
        ) {
          this.logger.warn(
            `Invitation refused: ${byOrganization} invitation(s) in organization ${organization.id} (${canceled} canceled) and ${byInviter} by user ${invitedByUser.id} in the last 24 hours`,
          );
          throw new RpcException({
            code: status.RESOURCE_EXHAUSTED,
            message: 'Too many invitations sent in the last 24 hours',
          });
        }

        // 3. Duplicate check, under the same lock: two parallel invitations
        //    of the same e-mail can no longer both pass it.
        const existingInvitation = await manager.findOne(
          OrganizationInvitation,
          {
            where: {
              email: normalizeEmail(request.email),
              organization: { id: organization.id },
              expiresAt: MoreThan(new Date()),
              status: 'pending',
            },
          },
        );
        if (existingInvitation) {
          throw new RpcException({
            code: status.ALREADY_EXISTS,
            message: 'Invitation already exists and not expired',
          });
        }

        // 4. Insert. The lock is held until commit, so the next invitation to
        //    this organization counts this one.
        // The token goes to the invitee once (mail, link, or this response
        // without SMTP); only its SHA-256 is stored.
        const token = randomBytes(32).toString('hex');

        const invitation: OrganizationInvitation = new OrganizationInvitation();
        invitation.organization = organization;
        invitation.invitedBy = invitedByUser;
        invitation.email = normalizeEmail(request.email);
        invitation.role = request.role;
        invitation.tokenHash = tokenHash(token);
        invitation.teamAssignments = request.teamAssignments || null;
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        Object.assign(invitation, this.memberProducts.invitationColumns(grant));

        const saved = await manager.save(OrganizationInvitation, invitation);
        return { saved, token };
      });

    this.logger.log(
      `Created organization invitation ${organizationInvitation.id} in organization ${organization.id}`,
    );

    // Mirror the invitation in the identity provider (best-effort, never
    // rejects).
    await this.identity.invitationCreated(
      organization,
      organizationInvitation,
      invitedByUser,
    );

    const response: OrganizationInviteResponse = {
      id: organizationInvitation.id,
      token: invitationToken,
      email: organizationInvitation.email,
      status: organizationInvitation.status,
      organizationId: organizationInvitation.organization.id,
      organizationName: organizationInvitation.organization.name,
      organizationRole: organizationInvitation.role,
      expiresAt: organizationInvitation.expiresAt
        ? organizationInvitation.expiresAt.toISOString()
        : '',
    };
    // The token is hidden only once the mail went out. With no SMTP
    // configured the mail is skipped and the caller gets the token back, so
    // the dashboard can show the invitation link itself.
    const sent = await this.mailService.sendOrganizationInviteEmail(response);

    if (sent) {
      this.logger.log(
        `Sent organization invite email for organization ${response.organizationId}`,
      );
      response.token = null;
    }
    return response;
  }

  /**
   * Get all pending invitations for an organization
   *
   * @param request - The request data
   * @returns The response with the pending invitations
   */
  @Span()
  async getOrganizationInvitations(
    request: OrganizationGetInvitationsRequest,
  ): Promise<GetOrganizationInvitationsResponse> {
    const invitations = await this.organizationInvitationRepository.find({
      where: {
        organization: { id: request.organizationId },
        status: 'pending',
        expiresAt: MoreThan(new Date()),
      },
      relations: ['organization'],
    });

    const response: GetOrganizationInvitationsResponse = {
      organizationId: request.organizationId,
      invitations: [],
    };

    if (invitations.length > 0) {
      response.invitations = invitations.map((invitation) => {
        return {
          id: invitation.id,
          token: null,
          email: invitation.email,
          status: invitation.status,
          organizationId: invitation.organization.id,
          organizationName: invitation.organization.name,
          organizationRole: invitation.role,
          expiresAt: invitation.expiresAt
            ? invitation.expiresAt.toISOString()
            : '',
        };
      });
    }

    return response;
  }

  /**
   * Cancel an invitation
   *
   * @param request - The request data
   * @returns The response with the canceled invitation
   */
  @Span()
  async cancelInvitation(
    request: OrganizationCancelRequest,
  ): Promise<OrganizationInviteResponse> {
    // Scope the lookup by both invitation id AND organization id to prevent
    // a cross-tenant IDOR: an admin of org A must not be able to cancel
    // invitations belonging to org B by smuggling a foreign invitationId
    // through the path /organization/:organizationId/invitation/:invitationId.
    // If the invitation does not belong to the path's organization, return
    // the same NOT_FOUND response as a truly missing invitation (no oracle).
    const invitation = await this.organizationInvitationRepository.findOne({
      where: {
        id: request.invitationId,
        organization: { id: request.organizationId },
      },
      relations: ['organization'],
    });

    if (!invitation) {
      this.logger.warn(`Invitation not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Invitation not found',
      });
    }

    if (invitation.status !== 'pending') {
      this.logger.warn(`Invitation has already been accepted or canceled`);
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has already been accepted or canceled',
      });
    }

    invitation.status = 'canceled';
    await this.organizationInvitationRepository.save(invitation);

    // Revoke the mirrored invitation, if any (best-effort, never rejects).
    await this.identity.invitationCanceled({
      ...invitation,
      organizationId: invitation.organization.id,
    });

    return {
      id: invitation.id,
      token: null,
      email: invitation.email,
      status: invitation.status,
      organizationId: invitation.organization.id,
      organizationName: invitation.organization.name,
      organizationRole: invitation.role,
      expiresAt: invitation.expiresAt ? invitation.expiresAt.toISOString() : '',
    };
  }

  /**
   * Cancel every pending, non-expired invitation for an organization.
   * Used by billing-service when downgrading to the developer plan,
   * which disallows pending invites from existing.
   *
   * Each invitation is cancelled individually via the existing
   * `cancelInvitation` flow so that Logto sync stays consistent. Failures
   * on individual invites are logged and do NOT abort the loop.
   */
  @Span()
  async cancelAllPendingInvitations(
    request: CancelAllPendingInvitationsRequest,
  ): Promise<CancelAllPendingInvitationsResponse> {
    const pending = await this.organizationInvitationRepository.find({
      where: {
        organization: { id: request.organizationId },
        status: 'pending',
        expiresAt: MoreThan(new Date()),
      },
    });

    let cancelledCount = 0;
    for (const inv of pending) {
      try {
        await this.cancelInvitation({
          organizationId: request.organizationId,
          invitationId: inv.id,
        });
        cancelledCount++;
      } catch (err) {
        this.logger.warn(
          `cancelAllPendingInvitations: failed to cancel ${inv.id} for org ${request.organizationId}: ${(err as any)?.message ?? String(err)}`,
        );
      }
    }

    this.logger.log(
      `cancelAllPendingInvitations: cancelled ${cancelledCount}/${pending.length} pending invites for org ${request.organizationId}`,
    );

    return { cancelledCount };
  }

  /**
   * One organisation's answer: its identity and scan limit, then the fields
   * the edition adds (ORGANIZATION_PROFILE_PORT; none in the Community
   * Edition).
   */
  private toOrganizationInformations(
    organization: Organization,
  ): OrganizationInformationsResponse {
    return {
      id: organization.id,
      name: organization.name,
      industry: organization.industry,
      country: organization.country,
      concurrentScanLimit: organization.concurrentScanLimit,
      ...this.organizationProfile.answerFields(organization),
    } as OrganizationInformationsResponse;
  }

  /**
   * Get an organization by its ID
   *
   * @param request - The request data
   * @returns The organization information
   */
  @Span()
  async getOrganizationById(
    request: OrganizationGetRequest,
  ): Promise<OrganizationInformationsResponse> {
    const organization = await this.organizationRepository.findOne({
      where: {
        id: request.organizationId,
      },
    });
    if (!organization) {
      this.logger.warn(
        `Organization with ID ${request.organizationId} not found`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Organization not found`,
      });
    }
    return this.toOrganizationInformations(organization);
  }

  /**
   * Get organizations by user ID
   *
   * @param request - The request data
   * @returns The organizations information
   */
  @Span()
  async getOrganizations(
    request: OrganizationGetAllRequest,
  ): Promise<OrganizationInformationsResponse[]> {
    const organizations = await this.organizationRepository.find({
      relations: ['userMemberships'],
      where: { userMemberships: { user: { id: request.userId } } },
    });

    if (organizations.length === 0) {
      return [];
    }

    return organizations.map((organization) =>
      this.toOrganizationInformations(organization),
    );
  }

  /**
   * Create an organization
   *
   * @param request - The request data
   * @returns The organization information
   */
  @Span()
  async createOrganization(
    request: OrganizationCreateRequest,
  ): Promise<OrganizationCreateResponse> {
    const user = await this.userRepository.findOne({
      where: { id: request.creatorId },
    });

    if (!user) {
      this.logger.warn(`User with ID ${request.creatorId} not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    // One creation at a time per creator, the check below included: a burst
    // of creations by one user each passed it before any had committed. The
    // lock is held until the creation has settled (committed, or rolled back
    // by the cleanup below), so the next one sees its outcome.
    return withMembershipLock(
      this.dataSource,
      'creator',
      user.id,
      user.id,
      () => this.createOrganizationLocked(request, user),
    );
  }

  private async createOrganizationLocked(
    request: OrganizationCreateRequest,
    user: User,
  ): Promise<OrganizationCreateResponse> {
    const existingOrganizationForUser =
      await this.organizationRepository.findOne({
        where: { creator: { id: request.creatorId } },
      });

    if (existingOrganizationForUser) {
      this.logger.warn(
        `User ${request.creatorId} already created an organization`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'User has already created an organization',
      });
    }

    // The edition's own columns of the new row, read from the request. A
    // request the edition refuses is refused here, before anything is
    // written (none in the Community Edition).
    const profileColumns = this.organizationProfile.creationColumns(request);

    // What the new organisation starts with is the edition's answer: the
    // Community Edition creates it active and unswitched
    // (true/false/false/false), the closed edition without product and
    // switched on (false/false/false/true). Read once, before the transaction, and used
    // for the row and the Permify seeding alike.
    const creationState = this.entitlements.organizationCreationState();

    const result = await this.dataSource.transaction(async (manager) => {
      // What the edition derives from the request (none in the Community
      // Edition): never a reason to refuse a creation.
      let signupColumns: Partial<Organization> = {};
      try {
        signupColumns = this.lifecycleHooks.signupColumns(request);
      } catch (err) {
        this.logger.warn(`Sign-up columns skipped: ${(err as Error).message}`);
      }

      const organization = manager.create(Organization, {
        name: request.name,
        // `industry` and `country` are varchar(255) NOT NULL with no default
        // (see CreateInitialTables / OrgIndustryAndContactCleanup), so they
        // need a value even when the caller supplies none. gRPC already
        // decodes an absent string as '' (loader `defaults: true`); this also
        // covers direct in-process callers.
        industry: request.industry || '',
        country: request.country || '',
        // The row's isActive and memberProducts come from the
        // edition's creation state; the Permify attributes are seeded with
        // the same state in one write (initializeOrganizationProducts below).
        isActive: creationState.isActive,
        concurrentScanLimit: 1,
        memberProducts: creationState.memberProducts,
        creator: user,
        ...profileColumns,
        ...signupColumns,
      });

      const newOrganization = await manager.save(organization);

      const membership = new UserOrganizationMembership();
      membership.organization = newOrganization;
      membership.user = user;
      membership.role = 'creator';

      await manager.save(membership);

      return newOrganization;
    });

    // The identity provider mirror shares nothing with the IAM relations and
    // the default team but the org id, so it runs beside them instead of
    // between them (in the cloud, an M2M token and up to three Logto calls,
    // ~0.75 s of a sign-up). It never rejects, and every path below awaits
    // it, a rollback first, so none of its writes lands after this call has
    // answered.
    const identityMirror = this.identity.organizationCreated(result, user);

    try {
      await this.authorizationService.organizationAddMember({
        organizationId: result.id,
        userId: user.id,
        role: 'creator',
      });
      // Every member write writes what the member holds beyond its role,
      // the creator's included.
      await this.memberProducts.memberArrived(result.id, user.id, {
        role: 'creator',
      });
      // The organisation's product attributes are seeded with the edition's
      // creation state in one write. Closed edition: no product, switched on,
      // is_active set when a product is activated. Community: AppSec active,
      // switch off.
      await this.authorizationService.initializeOrganizationProducts(
        result.id,
        creationState,
      );
    } catch (error) {
      this.logger.error(
        `Can't add IAM relation for user ${user.id} in organization ${result.id} : ${error}`,
      );
      await identityMirror;
      await this.organizationRepository.delete(result.id);
      this.logger.error(
        `Organization ${result.id} deleted due to IAM relation error`,
      );
      throw error;
    }

    const teamCreateRequest: TeamCreateRequest = {
      organizationId: result.id,
      name: 'Default team',
      description: 'Default team for the organization',
      creatorId: request.creatorId,
    };

    try {
      await this.teamService.createTeam(teamCreateRequest);
    } catch (error) {
      await identityMirror;
      await this.organizationRepository.delete(result.id);
      throw error;
    }

    // The mirror is settled before anything below answers or rolls back.
    await identityMirror;

    // No product and no trial at creation, so creating an organisation does
    // not depend on billing.
    // The edition's side effects of a creation (none in the Community
    // Edition) never reject, and are settled before the creation answers.
    await this.lifecycleHooks.afterOrganizationCreated({
      organization: result,
      creator: user,
      request,
    });

    return {
      message: 'Organization created successfully',
      organizationId: result.id,
      name: result.name,
      industry: result.industry,
    };
  }

  /**
   * Update an organization
   *
   * @param request - The request data
   * @returns The organization information
   */
  @Span()
  async updateOrganization(
    request: OrganizationUpdateRequest,
  ): Promise<OrganizationUpdateResponse> {
    const organization = await this.organizationRepository.findOne({
      where: { id: request.organizationId },
    });

    if (!organization) {
      this.logger.warn(
        `Organization with ID ${request.organizationId} not found`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Organization not found`,
      });
    }

    const updatableFields: Partial<
      Record<keyof OrganizationUpdateRequest, (value: any) => any>
    > = {
      name: (value) => value,
      industry: (value) => value,
      country: (value) => value,
      isActive: (value) => value,
      concurrentScanLimit: (value) => value,
      // Clamp to [1, 50] so the per-user diff-scan cap can never be
      // set to 0 (no diff scans) or an abusive value.
      diffScanMaxParallelPerUser: (value) =>
        Math.max(1, Math.min(50, Math.trunc(Number(value)) || 1)),
    };

    const previousName = organization.name;
    const previous = { ...organization } as Organization;

    for (const [field, transform] of Object.entries(updatableFields)) {
      const value = request[field as keyof OrganizationUpdateRequest];
      if (value !== undefined && value !== null) {
        (organization as any)[field] = transform(value);
      }
    }
    // The edition's own columns the request sets (none in the Community
    // Edition).
    Object.assign(
      organization,
      this.organizationProfile.updateColumns(request),
    );

    await this.organizationRepository.save(organization);

    // The billing profile handed to the edition (best-effort): it re-syncs
    // it only when a field it is built from changed.
    try {
      await this.entitlements.syncBillingProfile(organization, previous);
    } catch (e) {
      this.logger.warn(
        { err: (e as any)?.message },
        'Billing profile sync failed (ignored)',
      );
    }

    // Sync organization metadata to the identity provider (best-effort): it
    // holds the name only, so only a new name is worth the call.
    if (organization.name !== previousName) {
      await this.identity.organizationRenamed(organization);
    }

    return {
      message: 'Organization updated successfully',
    };
  }

  /**
   * E-mails the creator the code that confirms the organization's deletion.
   * Creator only; see OrganizationDeletionCodeService.
   */
  @Span()
  async requestOrganizationDeletionCode(
    request: RequestOrganizationDeletionCodeRequest,
  ): Promise<RequestOrganizationDeletionCodeResponse> {
    return this.deletionCodes.requestCode(request);
  }

  /**
   * The former Delete RPC, still called by an older gateway with no code:
   * refused whatever it carries, so that nothing deletes an
   * organization but confirmOrganizationDeletion. It reads nothing.
   */
  @Span()
  async deleteOrganization(
    request: OrganizationDeleteRequest,
  ): Promise<OrganizationDeleteResponse> {
    this.logger.warn(
      `ORGANIZATION_DELETE_REFUSED org=${request?.organizationId} reason=former_rpc`,
    );
    throw organizationDeletionRefusal('NOT_ORGANIZATION_CREATOR');
  }

  /**
   * Delete an organization: its creator only, with the code e-mailed to them,
   * verified and consumed before anything else of the deletion.
   *
   * @param request - The request data
   * @returns The response
   */
  @Span()
  async confirmOrganizationDeletion(
    request: ConfirmOrganizationDeletionRequest,
  ): Promise<OrganizationDeleteResponse> {
    const organization = await this.organizationRepository.findOne({
      where: { id: request.organizationId },
      relations: { creator: true },
    });
    if (!organization) {
      this.logger.warn(
        `Organization with ID ${request.organizationId} not found`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Organization not found`,
      });
    }

    // Throws a refusal of the closed list (organization-deletion-code.ts);
    // nothing below runs without a valid code from the creator.
    await this.deletionCodes.confirm(
      organization,
      request.requestedBy,
      request.confirmationCode,
    );

    const teams = await this.teamRepository.find({
      where: { organization: { id: request.organizationId } },
    });

    const teamIds = teams.map((team) => team.id);

    const projects = await this.projectRepository.find({
      where: { team: { id: In(teamIds) } },
    });

    const projectIds = projects.map((project) => project.id);

    await this.authorizationService.removeOrganization({
      organizationId: request.organizationId,
      teamIds: teamIds,
      projectIds: projectIds,
    });

    // Mirror the deletion in the identity provider (best-effort, never
    // rejects).
    await this.identity.organizationDeleted(organization);

    // The organization row (MySQL cascades its teams, projects, branch rows,
    // memberships and invitations) and its purge jobs, together or not at all:
    // one organization job and one job per project, from the ids read above,
    // since the cascade removes them. The organization job's `integrations`
    // step replaces a best-effort DeleteIntegrationsForOrg call.
    const jobIds = await this.dataSource.transaction(async (manager) => {
      await manager.delete(Organization, request.organizationId);
      return this.purgeLedger.enqueueOrganization(manager, {
        organizationId: request.organizationId,
        teamIds,
        projectIds,
      });
    });
    this.logger.log(
      `Organization ${request.organizationId} deleted — ${jobIds.length} purge job(s) recorded`,
    );
    // After the commit, never inside it (see ProjectService.deleteProject).
    try {
      this.purgeRunner.kick(jobIds);
    } catch (err) {
      this.logger.warn(
        `DATA_PURGE_KICK_FAILED jobs=${jobIds.length} error=${(err as Error)?.constructor?.name}`,
      );
    }

    return {
      message: `Organization with ID ${request.organizationId} deleted successfully`,
    };
  }

  /**
   * Get all members of an organization
   *
   * @param request - The request data
   * @returns The paginated members
   */
  @Span()
  async getMembersOrganization(
    request: OrganizationGetMembersRequest,
  ): Promise<PaginatedOrganizationMembersResponse> {
    const { page = 1, pageSize = 5, searchQuery = '' } = request;

    // One page and its total in SQL, instead of every membership and its
    // user. totalUsers counts what CountMembersInOrganization counts
    // (billing reads it as the member count): see readMembersPage.
    // The organisation's row, read with the page: its per-member switch
    // goes to the edition, which says what each member holds in force.
    const [[memberships, totalUsers], organization] = await Promise.all([
      readMembersPage(
        this.userOrganizationMembershipRepository
          .createQueryBuilder('membership')
          .leftJoinAndSelect('membership.user', 'user')
          .where('membership.organizationId = :organizationId', {
            organizationId: request.organizationId,
          }),
        { page, pageSize, searchQuery },
      ),
      this.organizationRepository.findOne({
        where: { id: request.organizationId },
        select: { id: true, memberProducts: true },
      }),
    ]);
    // An organization keeps at least its creator as a member: only an empty
    // answer can come from an unknown organization.
    if (totalUsers === 0 && !organization) {
      this.logger.warn(
        `Organization with ID ${request.organizationId} not found`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization with the provided ID does not exist.',
      });
    }

    const users = memberships.map((membership) => {
      return {
        id: membership.user.id,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        email: membership.user.email,
        picture: membership.user.picture,
        role: membership.role,
        products: this.memberProducts.productsInForce(
          organization?.memberProducts,
          membership,
        ),
      };
    });

    return {
      users,
      totalUsers,
      totalPages: membersPageCount(totalUsers, pageSize),
    };
  }

  /**
   * Accept an invitation to an organization
   *
   * @param request - The request data with the token
   * @returns The response with the organization information
   */
  @Span()
  async acceptInvitationFromOrganization(
    request: OrganizationAcceptInviteRequest,
  ): Promise<OrganizationAcceptInviteResponse> {
    const user = await this.userRepository.findOne({
      where: { id: request.userId },
    });

    if (!user) {
      // Never the token: it is a bearer credential for the invitation.
      this.logger.warn(
        `User with ID ${request.userId} not found to accept an invitation`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    // Looked up by the hash of the token alone: the token is never stored.
    const hashedToken = tokenHash(request.token ?? '');
    const invitation = await this.organizationInvitationRepository.findOne({
      where: {
        tokenHash: hashedToken,
        email: normalizeEmail(user.email),
      },
      relations: ['organization', 'invitedBy'],
    });

    if (!invitation) {
      // The address stays compared by the lookup above (the column collation
      // decides equality). A token sent to another address only changes the
      // refusal: a settled invitation is refused as such, since switching
      // accounts cannot revive it, and a live one tells the invitee to switch
      // accounts. The invited address is never returned.
      const sentToAnotherAddress =
        await this.organizationInvitationRepository.findOne({
          where: { tokenHash: hashedToken },
        });
      if (!sentToAnotherAddress) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'Invitation not found',
        });
      }
      this.assertInvitationIsOpen(sentToAnotherAddress);
      this.logger.warn(
        `Invitation ${sentToAnotherAddress.id} refused: user ${user.id} is signed in with a different email address`,
      );
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'This invitation was sent to a different email address',
      });
    }

    // Open, or consumed by an acceptance that never seated the member (see
    // below), and in both cases not expired.
    if (isConsumedNotSeated(invitation)) {
      this.assertInvitationNotExpired(invitation);
    } else {
      this.assertInvitationIsOpen(invitation);
    }
    // A role the edition gives nobody (the Community Edition's billing
    // manager) is not granted by an invitation created before.
    assertRoleAvailable(invitation.role);

    // The role, like the team seats below, is only worth what the inviter may
    // still grant: its author may have been demoted or removed since. Refused before anything is written.
    const inviterMembership = invitation.invitedBy
      ? await this.userOrganizationMembershipRepository.findOne({
          where: {
            user: { id: invitation.invitedBy.id },
            organization: { id: invitation.organization.id },
          },
        })
      : null;
    if (!mayInvite(inviterMembership?.role, invitation.role)) {
      this.logger.warn(
        `Invitation ${invitation.id} refused: inviter ${invitation.invitedBy?.id ?? 'unknown'} (role ${inviterMembership?.role ?? 'none'}) may no longer grant ${invitation.role} in organization ${invitation.organization.id}`,
      );
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation is no longer valid',
      });
    }

    const organization = await this.getOrganizationById({
      organizationId: invitation.organization.id,
    });

    // What the invitation gives beyond the role, as the edition decides it
    // from what the inviter may still give.
    const grant = this.memberProducts.acceptanceGrant(
      invitation,
      inviterMembership,
    );

    const organizationAddMember = {
      organizationId: invitation.organization.id,
      email: user.email,
      role: invitation.role,
      grant,
    };

    const alreadyAccepted = () =>
      new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has already been accepted or canceled',
      });
    const membershipExists = async () =>
      Boolean(
        await this.userOrganizationMembershipRepository.findOne({
          where: {
            user: { id: user.id },
            organization: { id: invitation.organization.id },
          },
        }),
      );

    // A member already: nothing to consume, as before.
    if (await membershipExists()) {
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'User is already a member of the organization',
      });
    }

    // The invitation is consumed before anything is written, by one
    // conditional update: of several acceptances sent at once, exactly one
    // turns it from pending to accepted. `acceptedAt` stays empty until the
    // member is seated: an invitation consumed by a request that never
    // finished (its process stopped) is completed by the next acceptance,
    // instead of staying refused for good.
    if (invitation.status === 'pending') {
      const consumed = await this.organizationInvitationRepository.update(
        { id: invitation.id, status: 'pending' },
        { status: 'accepted', acceptedAt: null },
      );
      if (consumed.affected !== 1) {
        const now = await this.organizationInvitationRepository.findOne({
          where: { id: invitation.id },
        });
        if (!now || !isConsumedNotSeated(now)) {
          this.logger.warn(
            `Invitation ${invitation.id} was accepted or canceled by a concurrent request`,
          );
          throw alreadyAccepted();
        }
      }
    }
    invitation.status = 'accepted';

    try {
      // Under the organisation lock: of two acceptances that both reach
      // here, the second finds the member the first seated.
      await this.addMemberOrganization(organizationAddMember);
    } catch (error) {
      const seated = await membershipExists().catch(() => true);
      if (seated) {
        // Another acceptance seated the member, or the cleanup could not
        // remove the row: the invitation stays consumed.
        if (
          error instanceof RpcException &&
          (error.getError() as { code?: number })?.code ===
            status.ALREADY_EXISTS
        ) {
          throw alreadyAccepted();
        }
      } else {
        // Nothing seated and every role tuple deleted (see
        // addMemberOrganization): the invitation is open again.
        await this.organizationInvitationRepository
          .update(
            { id: invitation.id, status: 'accepted', acceptedAt: IsNull() },
            { status: 'pending', acceptedAt: null },
          )
          .catch((reopen: unknown) =>
            this.logger.error(
              `Invitation ${invitation.id} not reopened after a failed acceptance: ${String(
                (reopen as Error)?.message ?? reopen,
              )}`,
            ),
          );
      }
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error adding member to organization',
      });
    }

    // Seated: the acceptance is complete and can no longer be resumed.
    const acceptedAt = new Date();
    await this.organizationInvitationRepository.update(
      { id: invitation.id, status: 'accepted', acceptedAt: IsNull() },
      { acceptedAt },
    );
    invitation.acceptedAt = acceptedAt;

    void this.realtime?.publish({
      eventId: ulid(),
      type: 'MEMBERSHIP_CHANGED',
      scope: { organizationId: invitation.organization.id, userId: user.id },
      payload: {
        membershipChanged: {
          userId: user.id,
          changeType: 'added',
          scopeType: 'organization',
          scopeId: invitation.organization.id,
        },
      },
    });

    // Auto-add user to selected teams if teamAssignments were specified
    if (invitation.teamAssignments && invitation.teamAssignments.length > 0) {
      this.logger.log(
        `Auto-adding user ${user.id} to ${invitation.teamAssignments.length} teams: ${invitation.teamAssignments.map((a) => `${a.teamId}:${a.role}`).join(', ')}`,
      );

      const inviterId = invitation.invitedBy?.id;
      // One team after the other: each seat takes a membership lock, and
      // seats taken all at once would hold as many lock connections.
      for (const assignment of invitation.teamAssignments) {
        await (async () => {
          try {
            // Re-checked now, when the seat is granted: its author may have
            // lost the team since the invitation was created.
            if (
              !inviterId ||
              !(await this.authorizationService.canAddTeamMember(
                assignment.teamId,
                inviterId,
              ))
            ) {
              this.logger.warn(
                `Not adding user ${user.id} to team ${assignment.teamId}: inviter ${inviterId ?? 'unknown'} may not add members to it`,
              );
              return;
            }
            await this.teamService.addMember({
              teamId: assignment.teamId,
              userId: user.id,
              role: assignment.role, // Use the specific role assigned for this team
            });
            this.logger.log(
              `Successfully added user ${user.id} to team ${assignment.teamId} with role ${assignment.role}`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to add user ${user.id} to team ${assignment.teamId}: ${error.message}`,
            );
            // Don't throw error - user is still member of organization
          }
        })();
      }
      this.logger.log(
        `Completed auto-adding user ${user.id} to teams for invitation ${invitation.id}`,
      );
    }

    return {
      message: 'Invitation accepted successfully',
      organization,
    };
  }

  /** Refuses an invitation that has expired, or was accepted or canceled. */
  private assertInvitationIsOpen(invitation: OrganizationInvitation): void {
    this.assertInvitationNotExpired(invitation);
    if (invitation.status !== 'pending') {
      this.logger.warn(
        `Invitation ${invitation.id} has already been accepted or canceled`,
      );
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has already been accepted or canceled',
      });
    }
  }

  private assertInvitationNotExpired(invitation: OrganizationInvitation): void {
    if (invitation.expiresAt < new Date()) {
      this.logger.warn(
        `Invitation ${invitation.id} has expired since ${invitation.expiresAt}`,
      );
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Invitation has expired',
      });
    }
  }

  /**
   * Add a member to an organization
   * @param data - The request data with the member information
   * @returns The response with the member information
   */
  @Span()
  async addMemberOrganization(
    data: {
      organizationId: string;
      email: string;
      role: string;
      /** What the member gets beyond the role (an accepted invitation). */
      grant?: MemberGrant;
    },
    options?: {
      skipLogtoSync?: boolean;
      /** An SSO arrival: the edition decides what it gets. */
      productsFromSso?: boolean;
    },
  ): Promise<{ message: string; userId: string }> {
    const user = await this.userRepository.findOne({
      where: { email: normalizeEmail(data.email) },
    });

    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User with email not found',
      });
    }

    // Two arrivals of the same user (an invitation accepted twice, a
    // webhook and an acceptance) run one after the other: the second one
    // finds the membership the first one wrote.
    return withMembershipLock(
      this.dataSource,
      'organization',
      data.organizationId,
      user.id,
      () => this.addMemberOrganizationLocked(user, data, options),
    );
  }

  private async addMemberOrganizationLocked(
    user: User,
    data: {
      organizationId: string;
      email: string;
      role: string;
      grant?: MemberGrant;
    },
    options?: {
      skipLogtoSync?: boolean;
      productsFromSso?: boolean;
    },
  ): Promise<{ message: string; userId: string }> {
    const organization = await this.organizationRepository.findOne({
      where: { id: data.organizationId },
    });

    if (!organization) {
      this.logger.warn(`Organization ${data.organizationId} not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization with ID not found',
      });
    }

    const existingMembership =
      await this.userOrganizationMembershipRepository.findOne({
        where: {
          user: { id: user.id },
          organization: { id: organization.id },
        },
      });

    if (existingMembership) {
      this.logger.warn(
        `User ${user.id} is already a member of organization ${organization.id}`,
      );
      throw new RpcException({
        code: status.ALREADY_EXISTS,
        message: 'User is already a member of the organization',
      });
    }

    // The membership, as the edition inserts it (the role alone in the
    // Community Edition).
    let membership: UserOrganizationMembership | null;
    try {
      membership = await this.memberProducts.insertMembership({
        organization,
        user,
        role: data.role,
        grant: data.grant,
        sso: Boolean(options?.productsFromSso),
      });
      if (!membership) {
        membership = new UserOrganizationMembership();
        membership.organization = organization;
        membership.user = user;
        membership.role = data.role;
        await this.userOrganizationMembershipRepository.save(membership);
      }
    } catch (error) {
      // The unique (organizationId, userId) index: a membership written by a
      // writer that does not take the lock above.
      if (isUniqueViolation(error)) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'User is already a member of the organization',
        });
      }
      throw error;
    }

    // What the member holds beyond its role first, then the role: without
    // the role it grants nothing, so a failure in between leaves nothing
    // usable.
    try {
      await this.memberProducts.memberArrived(
        data.organizationId,
        user.id,
        membership,
      );
      await this.authorizationService.organizationAddMember({
        organizationId: data.organizationId,
        userId: user.id,
        role: data.role,
      });
    } catch (error) {
      this.logger.error(
        `Can't add IAM relation for user ${user.id} in organization ${data.organizationId} : ${error}`,
      );
      // The role write may have reached the permission engine although the
      // call failed (a deadline): every role of the user goes first, then
      // the row. If either step fails, the row stays, so the caller knows
      // the arrival was not undone.
      try {
        await this.authorizationService.organizationRemoveMember({
          organizationId: data.organizationId,
          userId: user.id,
        });
        await this.userOrganizationMembershipRepository.remove(membership);
      } catch (cleanup) {
        this.logger.error(
          `Arrival of user ${user.id} in org ${data.organizationId} not undone after a failed add: ${String(
            (cleanup as Error)?.message ?? cleanup,
          )}`,
        );
      }
      await this.memberProducts
        .memberLeft(data.organizationId, user.id)
        .catch((cleanup: unknown) =>
          this.logger.warn(
            `Product tuples of user ${user.id} in org ${data.organizationId} not deleted after a failed add (inert without the role): ${String(
              (cleanup as Error)?.message ?? cleanup,
            )}`,
          ),
        );
      throw error;
    }

    // Notify Billing to refresh entitlements/quota based on new active member
    // count; `membersChanged` also grows the second product's automatic caps.
    try {
      await this.entitlements.getEntitlements(data.organizationId, {
        membersChanged: true,
      });
    } catch (e) {
      this.logger.warn(
        `Billing refresh (getEntitlements) failed after add member for org ${data.organizationId}: ${(e as any)?.message}`,
      );
    }

    // Mirror the member in the identity provider (best-effort, never
    // rejects) — skip when triggered by a Logto webhook.
    if (!options?.skipLogtoSync) {
      await this.identity.memberAdded(organization, user, data.role);
    }

    return {
      message: 'User added to organization successfully',
      userId: user.id,
    };
  }

  /**
   * Update the role of a member in an organization
   *
   * Ranked like an invitation: the actor
   * (`updatedBy`, the gateway's token subject) must be allowed to invite
   * both the member's current role and the new one. An administrator
   * therefore neither appoints nor demotes an administrator: the creator
   * does. No actor named (an older gateway) is refused. `creator`, or any
   * role outside the schema, is never given.
   *
   * @param request - The request data with the member information
   * @returns The response with the member information
   */
  @Span()
  async updateMemberRole(
    request: OrganizationUpdateRoleRequest,
  ): Promise<OrganizationUpdateRoleResponse> {
    const { userId, organizationId, role } = request;

    if (!ASSIGNABLE_ORGANIZATION_ROLES.has(role)) {
      this.logger.warn(
        `Role change in org ${organizationId} refused: unknown role ${JSON.stringify(role)}`,
      );
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Unknown organization role',
      });
    }
    assertRoleAvailable(role);

    // One write at a time for this member of this organisation, the
    // membership read again under the lock: a removal sent alongside either
    // runs first (and this change finds no membership) or after it.
    return withMembershipLock(
      this.dataSource,
      'organization',
      organizationId,
      userId,
      () => this.updateMemberRoleLocked(request),
    );
  }

  private async updateMemberRoleLocked(
    request: OrganizationUpdateRoleRequest,
  ): Promise<OrganizationUpdateRoleResponse> {
    const { userId, organizationId, role } = request;

    const targetMembership =
      await this.userOrganizationMembershipRepository.findOne({
        where: {
          user: { id: userId },
          organization: { id: organizationId },
        },
        relations: ['user', 'organization'],
      });

    if (!targetMembership) {
      this.logger.warn(`Membership not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Membership not found',
      });
    }

    if (targetMembership.role === 'creator') {
      this.logger.warn(`Creator role cannot be modified`);
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Creator role cannot be modified',
      });
    }

    // The actor's own role in THIS organisation, read here, never taken on
    // the gateway's word (as an inviter's is).
    const actor = request.updatedBy
      ? await this.userOrganizationMembershipRepository.findOne({
          where: {
            user: { id: request.updatedBy },
            organization: { id: organizationId },
          },
        })
      : null;
    if (
      !mayInvite(actor?.role, targetMembership.role) ||
      !mayInvite(actor?.role, role)
    ) {
      this.logger.warn(
        `User ${request.updatedBy || 'unknown'} (role ${actor?.role ?? 'none'}) may not turn ${userId} from ${targetMembership.role} into ${role} in organization ${organizationId}`,
      );
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'User not allowed to give this role',
      });
    }

    // What the new role changes beyond the relation, applied by the edition
    // BEFORE the relation is written (it may refuse, nothing changed); its
    // answer puts it back should the relation write fail.
    const restore = await this.memberProducts.beforeRoleChange(
      organizationId,
      targetMembership,
      role,
    );

    try {
      await this.authorizationService.updateOrganizationRole({
        organizationId,
        userId,
        role,
      });
    } catch (error) {
      if (restore) {
        await restore().catch((restoreError: unknown) =>
          this.logger.error(
            `Products of user ${userId} in org ${organizationId} not put back after a failed promotion: ${String(
              (restoreError as Error)?.message ?? restoreError,
            )}`,
          ),
        );
      }
      throw error;
    }

    // The role alone: the entity read at the start carries columns that a
    // concurrent product change may have moved since, and save() would put
    // them back.
    const previousRole = targetMembership.role;
    targetMembership.role = role;
    await this.userOrganizationMembershipRepository.update(
      { id: targetMembership.id },
      { role },
    );
    this.logger.log(
      `Role of user ${userId} in org ${organizationId} changed from ${previousRole} to ${role} by ${request.updatedBy} (${actor?.role})`,
    );
    void this.realtime?.publish({
      eventId: ulid(),
      type: 'MEMBERSHIP_CHANGED',
      scope: { organizationId, userId },
      payload: {
        membershipChanged: {
          userId,
          changeType: 'role_changed',
          scopeType: 'organization',
          scopeId: organizationId,
        },
      },
    });

    // Mirror the role change in the identity provider (best-effort, never
    // rejects).
    await this.identity.memberRoleChanged(
      targetMembership.organization,
      targetMembership.user,
      role,
    );

    return {
      message: 'User role updated successfully',
    };
  }

  /**
   * Delete a member from an organization
   *
   * Ranked like an invitation: the actor
   * (`removedBy`, the gateway's token subject) must be allowed to invite the
   * member's role, or be removing themself (leaving). A manager therefore
   * removes members only, an administrator never another administrator, and
   * the creator anyone but themself. No actor named (an older gateway) is
   * refused. `fromLogto`: the removal mirrors one Logto made (its webhook),
   * so there is no actor of ours to rank.
   *
   * The member's team tuples go first, and their failure fails the removal
   * before anything else changes: a leftover team tuple would keep reading
   * the team's projects.
   *
   * @param request - The request data with the member information
   * @returns The response
   */
  @Span()
  async deleteMember(
    request: OrganizationDeleteMemberRequest,
    options?: { skipLogtoSync?: boolean; fromLogto?: boolean },
  ): Promise<OrganizationDeleteMemberResponse> {
    // Serialised with every other write on this member of this organisation
    // (see updateMemberRole).
    return withMembershipLock(
      this.dataSource,
      'organization',
      request.organizationId,
      request.userId,
      () => this.deleteMemberLocked(request, options),
    );
  }

  private async deleteMemberLocked(
    request: OrganizationDeleteMemberRequest,
    options?: { skipLogtoSync?: boolean; fromLogto?: boolean },
  ): Promise<OrganizationDeleteMemberResponse> {
    const organization = await this.organizationRepository.findOne({
      where: { id: request.organizationId },
      relations: ['userMemberships', 'userMemberships.user'],
    });

    if (!organization) {
      this.logger.warn(`Organization ${request.organizationId} not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Organization with ID not found',
      });
    }

    const targetMembership = organization.userMemberships.find(
      (membership) => membership.user.id === request.userId,
    );

    if (!targetMembership) {
      this.logger.warn(
        `User ${request.userId} is not a member of the organization ${request.organizationId}`,
      );
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User is not a member of the organization',
      });
    }

    if (targetMembership.role === 'creator') {
      this.logger.warn(
        `Creator cannot be removed from the organization ${request.organizationId}`,
      );
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Creator cannot be removed',
      });
    }

    if (!options?.fromLogto) {
      const removedBy = request.removedBy;
      const leaving = !!removedBy && removedBy === request.userId;
      const actor = removedBy
        ? organization.userMemberships.find(
            (membership) => membership.user.id === removedBy,
          )
        : undefined;
      if (!leaving && !mayInvite(actor?.role, targetMembership.role)) {
        this.logger.warn(
          `User ${removedBy || 'unknown'} (role ${actor?.role ?? 'none'}) may not remove ${request.userId} (role ${targetMembership.role}) from organization ${request.organizationId}`,
        );
        throw new RpcException({
          code: status.PERMISSION_DENIED,
          message: 'User not allowed to remove a member with this role',
        });
      }
    }

    // Sign the member out before anything is removed: a failure stops here
    // with the member still in place, so the removal can be retried.
    await this.identity.memberLeaving(organization, targetMembership.user);

    // The identity provider drops its copy of the membership first, and its
    // refusal refuses the removal before anything changes here: a membership
    // it kept would come back at its next membership sync, with the role it
    // had there. Not asked when the provider itself removed the member.
    if (!options?.skipLogtoSync) {
      await this.identity.removeMember(organization, targetMembership.user);
    }

    const teamMemberships = await this.userTeamMembershipRepository.find({
      where: {
        user: { id: request.userId },
        team: { organization: { id: request.organizationId } },
      },
      relations: ['team'],
    });

    if (teamMemberships.length > 0) {
      this.logger.log(
        `User ${request.userId} is in ${teamMemberships.length} teams. Force-removing from all.`,
      );

      // Use forceRemoveMemberFromTeams which bypasses "last member" and "team_manager" guards
      // and removes user from all teams in a single DB operation. Its
      // failure fails the removal: it deletes the team rows only once
      // every team tuple is gone, and nothing below has run yet.
      const teamIds = teamMemberships.map((tm) => tm.team.id);
      const result = await this.teamService.forceRemoveMemberFromTeams({
        userId: request.userId,
        teamIds,
      });
      this.logger.log(
        `Force-removed user ${request.userId} from ${result.removedCount} teams`,
      );
    }

    await this.authorizationService.organizationRemoveMember({
      organizationId: request.organizationId,
      userId: request.userId,
    });

    // What the member held beyond its role goes too. Best-effort: without
    // the role it grants nothing, and a later arrival of the same user
    // rewrites it exactly.
    try {
      await this.memberProducts.memberLeft(
        request.organizationId,
        request.userId,
      );
    } catch (error) {
      this.logger.warn(
        `Product tuples of user ${request.userId} in org ${request.organizationId} not deleted (inert without the role): ${String(
          (error as Error)?.message ?? error,
        )}`,
      );
    }

    await this.userOrganizationMembershipRepository.remove(targetMembership);
    this.logger.log(
      `User ${request.userId} (role ${targetMembership.role}) removed from org ${request.organizationId} by ${options?.fromLogto ? 'Logto' : request.removedBy}`,
    );
    void this.realtime?.publish({
      eventId: ulid(),
      type: 'MEMBERSHIP_CHANGED',
      scope: { organizationId: request.organizationId, userId: request.userId },
      payload: {
        membershipChanged: {
          userId: request.userId,
          changeType: 'removed',
          scopeType: 'organization',
          scopeId: request.organizationId,
        },
      },
    });

    // Notify Billing to refresh entitlements/quota after member removal
    // (`membersChanged`: the second product's caps never go down, billing decides).
    try {
      await this.entitlements.getEntitlements(request.organizationId, {
        membersChanged: true,
      });
    } catch (e) {
      this.logger.warn(
        `Billing refresh (getEntitlements) failed after remove member for org ${request.organizationId}: ${(e as any)?.message}`,
      );
    }

    return {
      message: 'User removed from organization successfully',
    };
  }

  /**
   * Get organization id with project id linked
   *
   * @param projectId - The project id
   * @returns The organization id and the project's team id
   */
  @Span()
  async getOrganizationIdByProjectId(
    projectId: string,
  ): Promise<OrganizationGetIdByProjectIdResponse> {
    // Two ids, one SELECT. A findOne with relations would pay a
    // `SELECT DISTINCT` pre-query, then read ~110 columns to return these two.
    // The organization is joined so that only an existing one is returned.
    const row = await this.projectRepository
      .createQueryBuilder('project')
      .innerJoin('project.team', 'team')
      .innerJoin('team.organization', 'organization')
      .select('organization.id', 'organizationId')
      .addSelect('team.id', 'teamId')
      .where('project.id = :projectId', { projectId })
      .getRawOne<{ organizationId: string; teamId: string }>();

    if (!row) {
      this.logger.warn(`Project with ID ${projectId} not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Project not found',
      });
    }

    // policy-management reads the team here instead of paying a full
    // ProjectService/Get.
    return {
      organizationId: row.organizationId,
      teamId: row.teamId,
    };
  }

  /**
   * Get the organization a team belongs to. The gateway checks the features
   * of that organization on /team/:teamId/* routes.
   *
   * @param teamId - The team id
   * @returns The organization id
   */
  @Span()
  async getOrganizationIdByTeamId(
    teamId: string,
  ): Promise<OrganizationGetIdByTeamIdResponse> {
    if (!teamId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Error getting organization id by team id: Missing team id',
      });
    }
    const team = await this.teamRepository.findOne({
      where: { id: teamId },
      relations: ['organization'],
    });
    if (!team?.organization) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    }
    return { organizationId: team.organization.id };
  }

  /**
   * Get organization details with project id linked
   *
   * @param projectId - The project id
   * @returns The organization details
   */
  @Span()
  async getOrganizationByProject(
    projectId: string,
  ): Promise<OrganizationInformationsResponse> {
    const project = await findProjectWithTeamOrg(
      this.projectRepository,
      projectId,
    );

    if (!project) {
      this.logger.warn(`Project with ID ${projectId} not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Project not found`,
      });
    }

    if (!project.team || !project.team.organization) {
      this.logger.warn(`Organization not found for project ID ${projectId}`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `Organization not found`,
      });
    }

    const organization = project.team.organization;

    return this.toOrganizationInformations(organization);
  }

  /**
   * The members billing counts, and the pending, unexpired invitations when
   * asked. The edition may count by product; otherwise every member, and the
   * organisation has no per-member switch.
   */
  async countMembersInOrganization(request: {
    organizationId: string;
    product?: string;
    includePendingInvitations?: boolean;
  }): Promise<CountMembersInOrganizationResponse> {
    if (!request?.organizationId) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'organizationId required',
      });
    }
    const byEdition = await this.memberProducts.countMembers(request);
    if (byEdition) return byEdition;
    const organization = { id: request.organizationId };
    const totalMembers = await this.userOrganizationMembershipRepository.count({
      where: { organization },
    });
    const pendingInvitations = request.includePendingInvitations
      ? await this.organizationInvitationRepository.count({
          where: {
            organization,
            status: 'pending',
            expiresAt: MoreThan(new Date()),
          },
        })
      : 0;
    return { totalMembers, pendingInvitations, memberProducts: false };
  }
}
