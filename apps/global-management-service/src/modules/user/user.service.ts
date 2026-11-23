import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import { In, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { ident, isUniqueViolation } from '@cybedefend/db-dialect';
import { normalizeEmail } from 'src/core/db/normalize-email';

import { User } from 'src/entities/user.entity';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { MailService } from 'src/modules/mail/mail.service';

import {
  UserExistenceRequest,
  UserExistenceResponse,
  UserGetByEmailRequest,
  UserInformationsResponse,
  UserGetByIdRequest,
  UserGetByIdsRequest,
  UserGetByIdsResponse,
  UserCreateRequest,
  UserCreateResponse,
  UserDeleteRequest,
  UserDeleteResponse,
  UpdateUserProfileRequest,
  UserUpdateResponse,
  GetUserProfileRequest,
  GetUserProfileResponse,
  // Generated Organization shape in user proto may differ; use a minimal inline type compatible with our response
  Organization as ProtoOrganizationDto,
  Team as ProtoTeamDto,
  MyAccessibleProject,
  ListPersonalAccessTokensRequest,
  ListPersonalAccessTokensResponse,
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  DeletePersonalAccessTokenRequest,
  DeletePersonalAccessTokenResponse,
  UpdatePersonalAccessTokenNameRequest,
  UpdatePersonalAccessTokenNameResponse,
  CountPatsForOrgRequest,
  CountPatsForOrgResponse,
  DeleteAllPatsForOrgRequest,
  DeleteAllPatsForOrgResponse,
} from '@grpc/global-management/user';
import {
  ENTITLEMENTS_PORT,
  GlobalManagementEntitlementsPort,
  ProductStatus,
} from 'src/edition/ports/entitlements.port';
import {
  IDENTITY_PROVIDER_PORT,
  IdentityProviderPort,
} from 'src/edition/ports/identity-provider.port';
import {
  MEMBER_PRODUCTS_PORT,
  MemberProductsPort,
} from 'src/edition/ports/member-products.port';

/**
 * Hard cap on personal access tokens per user.
 *
 * Each PAT is a long-lived credential that can authenticate to the entire
 * API surface; a stolen PAT bypasses MFA. Capping the count limits blast
 * radius if one is exfiltrated and forces users to rotate rather than
 * pile up tokens. Enforced server-side in `createPersonalAccessToken` —
 * the dashboard mirrors the cap for UX, but the backend is the source of
 * truth (frontend gates can be bypassed).
 */
export const MAX_PATS_PER_USER = 10;

/** An organization of the caller, as its profile lists it. */
interface ProfileMembership {
  org: {
    id: string;
    name: string;
    country: string;
    industry: string;
    isActive: boolean;
  };
  /** The caller's role in the organization. */
  role: string;
  /**
   * The products the caller holds there in force, as the edition's member
   * access port says.
   */
  products: string[];
  /** The organisation's per-member products switch (`member_products`). */
  memberProducts: boolean;
  /** The caller's teams in the organization, with its role in each. */
  teams: ProtoTeamDto[];
}

/**
 * The most distinct ids one {@link UserService.getByIds} call reads. The
 * gateway's live sessions list names at most 200 sessions, so one call covers
 * it; a larger set is sent in several calls.
 */
export const USERS_BY_IDS_MAX = 200;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly logger: Logger,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    private readonly mailService: MailService,
    @Inject(IDENTITY_PROVIDER_PORT)
    private readonly identity: IdentityProviderPort,
    @Inject(ENTITLEMENTS_PORT)
    private readonly entitlements: GlobalManagementEntitlementsPort,
    @Inject(MEMBER_PRODUCTS_PORT)
    private readonly memberProducts: MemberProductsPort,
  ) {}

  /**
   * The products of each organisation, in ONE
   * batch call to billing. An organisation billing did not answer for, or
   * every organisation when billing fails, gets `[]`: "unknown", which the
   * dashboard must never read as "no product" (it would show the product
   * modal to an organisation that has products). The failure is logged once.
   */
  private async loadOrganizationProducts(
    organizationIds: string[],
  ): Promise<Map<string, ProductStatus[]>> {
    const byOrganization = new Map<string, ProductStatus[]>();
    if (organizationIds.length === 0) {
      return byOrganization;
    }
    try {
      return await this.entitlements.getProductsForOrganizations(
        organizationIds,
      );
    } catch (e) {
      this.logger.warn(
        {
          err: (e as Error)?.message,
          organizationCount: organizationIds.length,
        },
        'Failed to fetch organisation products, returned as unknown',
      );
    }
    return byOrganization;
  }

  @Span()
  async checkExistence(
    request: UserExistenceRequest,
  ): Promise<UserExistenceResponse> {
    const user = await this.userRepository.findOne({
      where: { email: normalizeEmail(request.email) },
    });
    return {
      exists: !!user,
      userId: user?.id ?? '',
    };
  }

  @Span()
  async getByEmail(
    request: UserGetByEmailRequest,
  ): Promise<UserInformationsResponse> {
    const user = await this.userRepository.findOne({
      where: { email: normalizeEmail(request.email) },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName ?? '',
      email: user.email,
      picture: user.picture ?? '',
    };
  }

  @Span()
  async getById(
    request: UserGetByIdRequest,
  ): Promise<UserInformationsResponse> {
    const user = await this.userRepository.findOne({
      where: { id: request.userId },
    });
    if (!user) {
      this.logger.warn(`User ${request.userId} not found`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName ?? '',
      email: user.email,
      picture: user.picture ?? '',
    };
  }

  /**
   * Several users in one query, for the gateway pages that name the user
   * behind each event (live agent sessions, guard triggers). The same users
   * {@link getById} answers, by id and with the same five fields; an id the
   * platform does not know is left out, where getById answers NOT_FOUND.
   * Blank and repeated ids are ignored; more than {@link USERS_BY_IDS_MAX}
   * distinct ids is the caller's mistake.
   */
  @Span()
  async getByIds(request: UserGetByIdsRequest): Promise<UserGetByIdsResponse> {
    const ids = [
      ...new Set(
        (request.userIds ?? [])
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => id !== ''),
      ),
    ];
    if (ids.length === 0) return { users: [] };
    if (ids.length > USERS_BY_IDS_MAX) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `At most ${USERS_BY_IDS_MAX} user ids per call.`,
      });
    }
    const users = await this.userRepository.find({
      select: ['id', 'firstName', 'lastName', 'email', 'picture'],
      where: { id: In(ids) },
    });
    return {
      users: users.map((user) => ({
        id: user.id,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        email: user.email ?? '',
        picture: user.picture ?? '',
      })),
    };
  }

  @Span()
  async create(request: UserCreateRequest): Promise<UserCreateResponse> {
    const user = this.userRepository.create({
      email: normalizeEmail(request.email),
      firstName: request.firstName,
      lastName: request.lastName ?? '',
      picture: request.picture ?? '',
    });
    try {
      await this.userRepository.save(user);
    } catch (error: any) {
      // Defense-in-depth for the UNIQUE constraint on `user.email`
      // (see migration AddUniqueEmailUserConstraint). Without this branch a
      // race between two concurrent Logto webhook events would surface as a
      // generic INTERNAL error and crash the create flow; we want a clean
      // ALREADY_EXISTS that the gateway maps to HTTP 409.
      if (isUniqueViolation(error)) {
        this.logger.warn('Duplicate email on user.create');
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'A user with this email already exists',
        });
      }
      this.logger.error(`Error while creating user`, error);
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Error creating user',
      });
    }

    this.logger.log(`Created user with ID: ${user.id}`);

    await this.mailService.sendWelcomeEmail(
      user.email,
      `${user.firstName} ${user.lastName || ''}`.trim(),
    );

    this.logger.log(`Sent welcome email to ${user.id}`);

    return {
      message: 'User created successfully',
      userId: user.id,
    };
  }

  @Span()
  async delete(request: UserDeleteRequest): Promise<UserDeleteResponse> {
    const user = await this.userRepository.findOne({
      where: { id: request.userId },
    });
    if (!user) {
      this.logger.warn(`User ${request.userId} not found for deletion`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }
    // An organization is deleted by its creator alone
    // (organization.creator is ON DELETE SET NULL), so its creator cannot
    // delete their account. Checked before any write, Logto included.
    const createdOrganizations = await this.organizationRepository.count({
      where: { creator: { id: user.id } },
    });
    if (createdOrganizations > 0) {
      this.logger.warn(
        `USER_DELETE_REFUSED user=${user.id} reason=organization_creator organizations=${createdOrganizations}`,
      );
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'USER_IS_ORGANIZATION_CREATOR',
      });
    }
    await this.userRepository.remove(user);
    this.logger.log(`Deleted user with ID: ${user.id}`);

    // Mirror the deletion in the identity provider (best-effort, never
    // rejects).
    await this.identity.userDeleted(user);

    return { message: 'User deleted successfully' };
  }

  @Span()
  async update(request: UpdateUserProfileRequest): Promise<UserUpdateResponse> {
    const user = await this.userRepository.findOne({
      where: { id: request.userId },
    });
    if (!user) {
      this.logger.warn(`User ${request.userId} not found for update`);
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    if (typeof request.notification === 'boolean') {
      user.notification = request.notification;
    }
    if (typeof request.isOnboardingCompleted === 'boolean') {
      user.isOnboardingCompleted = request.isOnboardingCompleted;
    }
    if (request.onboardingProgress) {
      try {
        const steps = JSON.parse(request.onboardingProgress);
        if (Array.isArray(steps)) {
          const existing = user.onboardingProgress || [];
          const merged = [...new Set([...existing, ...steps])];
          user.onboardingProgress = merged;
        }
      } catch {
        // Invalid JSON — ignore
      }
    }
    // Second-product dashboard link — onboarding persona/usage are a simple
    // overwrite (no Set-merge, unlike onboardingProgress).
    if (request.onboardingPersona !== undefined) {
      user.onboardingPersona = request.onboardingPersona;
    }
    if (request.onboardingUsage !== undefined) {
      user.onboardingUsage = request.onboardingUsage;
    }

    await this.userRepository.save(user);
    this.logger.log(`User ${user.id} updated successfully`);
    return {
      message: 'User updated successfully',
      userId: user.id,
    };
  }

  @Span()
  async getProfile(
    request: GetUserProfileRequest,
  ): Promise<GetUserProfileResponse> {
    const user = await this.userRepository.findOne({
      where: { id: request.userId },
    });
    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'User not found',
      });
    }

    const organizations = await this.loadProfileMemberships(user.id);

    const productsByOrganization = await this.loadOrganizationProducts(
      organizations.map(({ org }) => org.id),
    );

    const orgDtos: ProtoOrganizationDto[] = [];
    for (const {
      org,
      role,
      products: myProducts,
      memberProducts,
      teams: teamsDto,
    } of organizations) {
      // Fetch subscription summary from Billing (best-effort), through the
      // entitlements port: the mapping lives in its cloud implementation.
      let subscription: object | undefined = undefined;
      try {
        subscription = await this.entitlements.getSubscriptionSummary(org.id);
      } catch (e) {
        // An organisation that never activated AppSec
        // has no subscription row: billing answers NOT_FOUND and the summary
        // is simply absent. Only another failure is worth a warning.
        const code = (e as RpcException)?.getError?.() as
          | { code?: number }
          | string
          | undefined;
        if (typeof code !== 'object' || code?.code !== status.NOT_FOUND) {
          this.logger.warn(
            { err: (e as Error)?.message, orgId: org.id },
            'Failed to fetch subscription summary',
          );
        }
      }

      orgDtos.push({
        id: org.id,
        name: org.name,
        country: org.country,
        industry: org.industry,
        isActive: org.isActive,
        myTeams: teamsDto,
        myRole: role,
        subscription,
        // [] means unknown (billing failed), never "no product".
        products: productsByOrganization.get(org.id) ?? [],
        // The caller's own products: what it holds, active or not, and
        // that it was computed (an older global-management sends neither:
        // `myProducts: []` alone would read as « no product »).
        myProducts,
        myProductsKnown: true,
        // The switch itself, so the members page can say a product change
        // would take no effect while it is off.
        memberProducts,
      } as any);
    }

    const myAccessibleProjects = await this.loadAccessibleProjects(user.id);

    return {
      id: user.id,
      firstName: user.firstName,
      email: user.email,
      lastName: user.lastName ?? '',
      picture: user.picture ?? '',
      notification: user.notification,
      isOnboardingCompleted: user.isOnboardingCompleted,
      createdAt: user.createdAt ? user.createdAt.toISOString() : '',
      updatedAt: user.updatedAt ? user.updatedAt.toISOString() : '',
      myOrganizations: orgDtos as any,
      onboardingProgress: JSON.stringify(user.onboardingProgress || []),
      myAccessibleProjects,
      onboardingPersona: user.onboardingPersona ?? '',
      onboardingUsage: user.onboardingUsage ?? '',
    };
  }

  /**
   * The caller's organizations, its role in each, and its teams there with its
   * role in each: what `myOrganizations` carries.
   *
   * The profile used to load every team of every
   * organization of the caller with ALL their memberships and users (one row
   * per member of every team, for an administrator of a large organization),
   * to keep the caller's. Two reads of the caller's own rows, in parallel,
   * replace it: its organization memberships, and its team memberships.
   *
   * The previous read had no ORDER BY, so its order was the plan's. Both are
   * explicit here, and follow the plan the previous read used: the
   * organizations by
   * membership id (it read them through the userId index, whose rows are in
   * (userId, id) order), the teams of an organization by name
   * (IDX_team_org_name). Membership ids are random UUIDs: that order says
   * nothing of when the caller joined. When the caller holds two memberships
   * of one organization or team, the one with the lowest membership id gives
   * the role (the previous read took whichever its plan returned first).
   */
  private async loadProfileMemberships(
    userId: string,
  ): Promise<ProfileMembership[]> {
    const [organizationRows, teamRows] = await Promise.all([
      this.organizationRepository
        .createQueryBuilder('org')
        .innerJoin('org.userMemberships', 'membership')
        .where('membership.userId = :userId', { userId })
        .select('org.id', 'id')
        .addSelect('org.name', 'name')
        .addSelect('org.country', 'country')
        .addSelect('org.industry', 'industry')
        .addSelect('org.isActive', 'isActive')
        .addSelect('membership.role', 'role')
        .addSelect('membership.appsecAccess', 'appsecAccess')
        .addSelect('membership.vibedefendAccess', 'vibedefendAccess')
        .addSelect('org.memberProducts', 'memberProducts')
        .orderBy('membership.id', 'ASC')
        .getRawMany<{
          id: string;
          name: string;
          country: string;
          industry: string;
          // MySQL hands a TINYINT back as a number.
          isActive: boolean | number;
          role: string;
          appsecAccess: number | boolean;
          vibedefendAccess: number | boolean;
          memberProducts: number | boolean;
        }>(),
      this.teamRepository
        .createQueryBuilder('team')
        .innerJoin('team.userMemberships', 'membership')
        .where('membership.userId = :userId', { userId })
        .select('team.id', 'id')
        .addSelect('team.name', 'name')
        .addSelect('team.organizationId', 'organizationId')
        .addSelect('membership.role', 'role')
        .orderBy('team.name', 'ASC')
        .addOrderBy('team.id', 'ASC')
        .addOrderBy('membership.id', 'ASC')
        .getRawMany<{
          id: string;
          name: string;
          organizationId: string;
          role: string;
        }>(),
    ]);

    const teamsByOrganization = new Map<string, ProtoTeamDto[]>();
    const seenTeams = new Set<string>();
    for (const row of teamRows) {
      if (seenTeams.has(row.id)) continue;
      seenTeams.add(row.id);
      const teams = teamsByOrganization.get(row.organizationId) ?? [];
      teams.push({ id: row.id, name: row.name, myRole: row.role ?? '' });
      teamsByOrganization.set(row.organizationId, teams);
    }

    const organizations = new Map<string, ProfileMembership>();
    for (const row of organizationRows) {
      if (organizations.has(row.id)) continue;
      organizations.set(row.id, {
        org: {
          id: row.id,
          name: row.name,
          country: row.country,
          industry: row.industry,
          isActive: Boolean(Number(row.isActive)),
        },
        role: row.role ?? '',
        products: this.memberProducts.productsInForce(row.memberProducts, row),
        memberProducts: Boolean(Number(row.memberProducts ?? 0)),
        teams: teamsByOrganization.get(row.id) ?? [],
      });
    }
    return [...organizations.values()];
  }

  /**
   * Flat per-project listing surfaced alongside the profile.
   *
   * Same membership predicates as
   * ``ProjectService.getProjectsOrganization`` — creator/administrator
   * on the org, OR member of one of the owning teams — but lifts the
   * per-org filter so the dashboard gets every project the user can
   * see in one round-trip. The dashboard caches the result in Redux,
   * so page navigations don't refetch.
   *
   * Heavy vulnerability stats are intentionally NOT joined: this is the
   * "list" surface the global-chat scope, the chat scope dropdown and
   * project pickers consume. Detail screens still query the dedicated
   * per-org endpoint when they need MainStatistics.
   *
   * Capped at 500 rows to protect against a misconfigured tenant with an
   * enormous project count; mirrors the cap envisioned for the conversation
   * snapshot.
   *
   * This is an access control, and the set it returns is
   * the one the previous query returned (user.service.live.spec.ts runs both on
   * the same data). The previous query tested `EXISTS(uom) OR EXISTS(tm)` on
   * every (project, team, organization) of the platform: MySQL turns no OR of
   * two EXISTS into a semi-join, so its cost grew with the number of teams of
   * every tenant. This one starts from the caller: the teams it may read are
   * those of the organizations it created or administers (IDX_uom on userId,
   * then IDX_team_org_name) and those it is a member of (teams_members.userId),
   * deduplicated by the UNION; the projects come from those teams only. And
   * `.limit()` is a real LIMIT: TypeORM drops `.take()` on a raw read with
   * joins, so the documented cap of 500 did not exist. `project.id` only breaks
   * ties the two names leave.
   */
  private async loadAccessibleProjects(
    userId: string,
  ): Promise<MyAccessibleProject[]> {
    const HARD_MAX = 500;
    // camelCase identifiers are quoted (db-dialect): PostgreSQL folds an
    // unquoted one to lower case.
    const q = (name: string) => ident(name).text;
    const readableTeams = `(
      SELECT t.id AS ${q('teamId')}
        FROM users_organizations_members uom
        INNER JOIN team t ON ${q('t.organizationId')} = ${q('uom.organizationId')}
       WHERE ${q('uom.userId')} = :userId AND uom.role IN (:...privilegedRoles)
      UNION
      SELECT ${q('tm.teamId')} AS ${q('teamId')}
        FROM teams_members tm
       WHERE ${q('tm.userId')} = :userId
    )`;
    const rows = await this.projectRepository
      .createQueryBuilder('project')
      .innerJoin('project.team', 'team')
      .innerJoin('team.organization', 'org')
      .innerJoin(readableTeams, 'readable', `${q('readable.teamId')} = team.id`)
      .setParameters({
        userId,
        privilegedRoles: ['creator', 'administrator'],
      })
      .select([
        `project.id AS ${q('projectId')}`,
        `project.name AS ${q('projectName')}`,
        `org.id AS ${q('organizationId')}`,
        `org.name AS ${q('organizationName')}`,
      ])
      .orderBy('org.name', 'ASC')
      .addOrderBy('project.name', 'ASC')
      .addOrderBy('project.id', 'ASC')
      .limit(HARD_MAX)
      .getRawMany<{
        projectId: string;
        projectName: string;
        organizationId: string;
        organizationName: string;
      }>();
    return rows.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName ?? '',
      organizationId: r.organizationId,
      organizationName: r.organizationName ?? '',
    }));
  }

  // ─── Personal Access Tokens ────────────────────────────────────
  // Stored by the identity provider (IDENTITY_PROVIDER_PORT): Logto in the
  // cloud, which also enforces MAX_PATS_PER_USER on creation.

  @Span()
  async listPersonalAccessTokens(
    request: ListPersonalAccessTokensRequest,
  ): Promise<ListPersonalAccessTokensResponse> {
    // The secret value is never listed: each token's `value` is ''.
    const tokens = await this.identity.listPersonalAccessTokens(request.userId);
    return {
      tokens,
      // Drives the dashboard's "X/10 PATs used" indicator and the
      // disabled-create-button state. The cap itself is enforced
      // server-side in createPersonalAccessToken.
      usage: {
        current: tokens.length,
        max: MAX_PATS_PER_USER,
      },
    };
  }

  @Span()
  async createPersonalAccessToken(
    request: CreatePersonalAccessTokenRequest,
  ): Promise<CreatePersonalAccessTokenResponse> {
    // The plain secret is returned EXACTLY ONCE, here, so the user can
    // copy it. Subsequent list calls return it as empty string.
    return this.identity.createPersonalAccessToken(
      request.userId,
      request.name,
      request.expiresAt,
    );
  }

  @Span()
  async deletePersonalAccessToken(
    request: DeletePersonalAccessTokenRequest,
  ): Promise<DeletePersonalAccessTokenResponse> {
    await this.identity.deletePersonalAccessToken(
      request.userId,
      request.tokenName,
    );
    return { message: 'Token deleted' };
  }

  @Span()
  async updatePersonalAccessTokenName(
    request: UpdatePersonalAccessTokenNameRequest,
  ): Promise<UpdatePersonalAccessTokenNameResponse> {
    return this.identity.renamePersonalAccessToken(
      request.userId,
      request.currentName,
      request.newName,
    );
  }

  /**
   * Count all PATs across every member of an organization. Used by
   * billing-service to populate the deletion preview shown to the user
   * before a Trial -> Developer plan transition.
   */
  @Span()
  async countPatsForOrg(
    request: CountPatsForOrgRequest,
  ): Promise<CountPatsForOrgResponse> {
    const count = await this.identity.countPersonalAccessTokensForOrganization(
      request.organizationId,
    );
    return { count };
  }

  /**
   * Delete every PAT for every member of an organization. Invoked by
   * billing-service after the Stripe checkout webhook fires for a
   * Trial -> Developer transition (best-effort, fail-soft per token).
   */
  @Span()
  async deleteAllPatsForOrg(
    request: DeleteAllPatsForOrgRequest,
  ): Promise<DeleteAllPatsForOrgResponse> {
    const deletedCount =
      await this.identity.deleteAllPersonalAccessTokensForOrganization(
        request.organizationId,
      );
    return { deletedCount };
  }
}
