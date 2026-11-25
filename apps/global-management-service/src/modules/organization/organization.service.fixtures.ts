import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import type { Provider } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

import { OrganizationService } from './organization.service';
import {
  ENTITLEMENTS_PORT,
  GlobalManagementEntitlementsPort,
} from 'src/edition/ports/entitlements.port';
import {
  IDENTITY_PROVIDER_PORT,
  IdentityProviderPort,
} from 'src/edition/ports/identity-provider.port';
import {
  ORGANIZATION_LIFECYCLE_HOOKS,
  OrganizationLifecycleHooks,
} from 'src/edition/ports/organization-lifecycle.port';
import {
  MEMBER_PRODUCTS_PORT,
  MemberProductsPort,
} from 'src/edition/ports/member-products.port';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from 'src/edition/community/member-products.binding';
import { ORGANIZATION_PROFILE_COMMUNITY_BINDINGS } from 'src/edition/community/organization-profile.binding';
import { Organization } from 'src/entities/organization.entity';
import { Team } from 'src/entities/team.entity';
import { Project } from 'src/entities/project.entity';
import { User } from 'src/entities/user.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { TeamService } from '../team/team.service';
import { MailService } from '../mail/mail.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { OrganizationDeletionCodeService } from './organization-deletion-code.service';
import {
  createLoggerMock,
  createMockRepository,
} from 'src/test-utils/typeorm-mock.util';
import { grantingCreateQueryRunner } from '../authorization/membership-lock.testing';

/** Extra providers for the test module; later entries override earlier ones with the same `provide`. */
export interface OrganizationFixtureOptions {
  providers?: Provider[];
}

/** The jest.fn()-backed ENTITLEMENTS_PORT the fixture provides by default: the CommunityEntitlements answers. */
export type EntitlementsMock = Record<
  keyof GlobalManagementEntitlementsPort,
  jest.Mock
>;

export function communityEntitlementsMock(): EntitlementsMock {
  return {
    isWritable: jest.fn(async () => ({ writable: true, trial: false })),
    hasFeature: jest.fn(async () => true),
    canInviteUser: jest.fn(async () => ({ allowed: true, reason: '' })),
    getEntitlements: jest.fn(async () => undefined),
    getOrganizationProducts: jest.fn(async () => [
      { product: 'appsec', status: 'active', trialUsed: false },
    ]),
    getProductsForOrganizations: jest.fn(
      async (organizationIds: string[]) =>
        new Map(
          organizationIds.map((id) => [
            id,
            [{ product: 'appsec', status: 'active', trialUsed: false }],
          ]),
        ),
    ),
    getSubscription: jest.fn(async () => ({ projectLimit: -1 })),
    getSubscriptionSummary: jest.fn(async () => undefined),
    syncBillingProfile: jest.fn(async () => false),
    organizationCreationState: jest.fn(() => ({
      isActive: true,
      writesBlocked: false,
      vibedefendActive: false,
      memberProducts: false,
    })),
  };
}

/** The jest.fn()-backed IDENTITY_PROVIDER_PORT the fixture provides by default: every mirror call resolves with nothing done. */
export type IdentityProviderMock = Record<
  keyof IdentityProviderPort,
  jest.Mock
>;

export function identityProviderMock(): IdentityProviderMock {
  return {
    organizationCreated: jest.fn(async () => undefined),
    organizationRenamed: jest.fn(async () => undefined),
    organizationDeleted: jest.fn(async () => undefined),
    invitationCreated: jest.fn(async () => undefined),
    invitationCanceled: jest.fn(async () => undefined),
    memberAdded: jest.fn(async () => undefined),
    memberRoleChanged: jest.fn(async () => undefined),
    memberLeaving: jest.fn(async () => undefined),
    removeMember: jest.fn(async () => undefined),
    userDeleted: jest.fn(async () => undefined),
    listPersonalAccessTokens: jest.fn(async () => []),
    createPersonalAccessToken: jest.fn(),
    deletePersonalAccessToken: jest.fn(async () => undefined),
    renamePersonalAccessToken: jest.fn(),
    countPersonalAccessTokensForOrganization: jest.fn(async () => 0),
    deleteAllPersonalAccessTokensForOrganization: jest.fn(async () => 0),
  };
}

/** The jest.fn()-backed ORGANIZATION_LIFECYCLE_HOOKS the fixture provides by default: the creation hooks resolve with nothing done. */
export type OrganizationLifecycleHooksMock = Record<
  keyof OrganizationLifecycleHooks,
  jest.Mock
>;

export function organizationLifecycleHooksMock(): OrganizationLifecycleHooksMock {
  return {
    signupColumns: jest.fn(() => ({})),
    afterOrganizationCreated: jest.fn(async () => undefined),
  };
}

/**
 * The one wiring of `OrganizationService` used by its specs
 * (`organization.service.spec.ts` and `organization.service.lead.spec.ts`).
 *
 * It lives outside the spec files because the constructor keeps growing —
 * every new dependency would otherwise have to be added to each spec's own
 * testing module by hand, and one of them would drift. Same reason (and same
 * placement rules) as `src/test-utils/typeorm-mock.util.ts`.
 *
 * The edition ports are provided as `entitlements`, a jest.fn()-backed object
 * with the CommunityEntitlements answers by default, and `identity`, a
 * jest.fn()-backed IDENTITY_PROVIDER_PORT, and `lifecycleHooks`, a
 * jest.fn()-backed ORGANIZATION_LIFECYCLE_HOOKS; `options.providers`
 * overrides any provider (the cloud fixture spreads
 * ENTITLEMENTS_CLOUD_BINDINGS, IDENTITY_PROVIDER_CLOUD_BINDINGS,
 * ORGANIZATION_LIFECYCLE_CLOUD_BINDINGS and their client mocks after them).
 */
export async function buildOrganizationService(
  options: OrganizationFixtureOptions = {},
) {
  const orgRepo = createMockRepository<Organization>();
  const teamRepo = createMockRepository<Team>();
  const projectRepo = createMockRepository<Project>();
  const userRepo = createMockRepository<User>();
  const uomRepo = createMockRepository<UserOrganizationMembership>();
  const utmRepo = createMockRepository<UserTeamMembership>();
  const invRepo = createMockRepository<OrganizationInvitation>();
  // The conditional update that consumes an invitation: it wins unless a
  // spec says otherwise.
  invRepo.update!.mockResolvedValue({ affected: 1 } as never);
  const mailService = {
    sendOrganizationInviteEmail: jest.fn().mockResolvedValue(undefined),
  };
  const teamService = {
    createTeam: jest.fn().mockResolvedValue({ id: 't1', name: 'Default team' }),
    addMember: jest.fn().mockResolvedValue({ message: 'added' }),
    forceRemoveMemberFromTeams: jest
      .fn()
      .mockResolvedValue({ message: 'removed', removedCount: 0 }),
  };
  const authorizationService = {
    organizationAddMember: jest.fn().mockResolvedValue(undefined),
    setOrganizationActive: jest.fn().mockResolvedValue(undefined),
    initializeOrganizationWithoutProduct: jest.fn().mockResolvedValue(true),
    initializeOrganizationProducts: jest.fn().mockResolvedValue(true),
    removeOrganization: jest.fn().mockResolvedValue(undefined),
    updateOrganizationRole: jest.fn().mockResolvedValue(undefined),
    organizationRemoveMember: jest.fn().mockResolvedValue(undefined),
    // Permify `team#add_user`. Denied unless a spec says who may staff which
    // team: an authorization double must never be the thing that grants access.
    canAddTeamMember: jest.fn().mockResolvedValue(false),
    // Per-member products (schema 1.5.0): the member's product tuples and the
    // organisation's member_products switch.
    setMemberProducts: jest.fn().mockResolvedValue(undefined),
    removeMemberProducts: jest.fn().mockResolvedValue(undefined),
    grantProductToMembers: jest.fn().mockResolvedValue(undefined),
    setMemberProductsSwitch: jest.fn().mockResolvedValue(true),
  };
  // ENTITLEMENTS_PORT, with the CommunityEntitlements answers by default:
  // every invitation allowed, AppSec active everywhere, no project limit.
  const entitlements = communityEntitlementsMock();
  // `createQueryRunner`: the connection of the membership locks, granted.
  const dataSource = {
    transaction: jest.fn(),
    createQueryRunner: grantingCreateQueryRunner(),
  };
  // The purge jobs an organization deletion records (one per subject).
  const purgeLedger = {
    enqueueOrganization: jest.fn(async () => ['job-o1']),
  };
  // Kicked with those jobs once the deletion is committed.
  const purgeRunner = { kick: jest.fn() };
  // The deletion confirmation: accepted unless a spec says
  // otherwise; organization-deletion-code.service.spec.ts tests the real one.
  const deletionCodes = {
    confirm: jest.fn<Promise<void>, unknown[]>(async () => undefined),
    requestCode: jest.fn<Promise<{ expiresAt: string }>, unknown[]>(
      async () => ({
        expiresAt: '2026-10-27T10:10:00.000Z',
      }),
    ),
  };
  const realtimePublisher = { publish: jest.fn().mockResolvedValue(undefined) };
  const deleteIntegrationsForOrg = jest.fn(() => of({ deletedCounts: {} }));
  // IDENTITY_PROVIDER_PORT: every mirror call resolves with nothing done.
  const identity = identityProviderMock();
  // ORGANIZATION_LIFECYCLE_HOOKS: the creation hooks resolve with nothing done.
  const lifecycleHooks = organizationLifecycleHooksMock();
  const logger = createLoggerMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrganizationService,
      { provide: getRepositoryToken(Organization), useValue: orgRepo },
      { provide: getRepositoryToken(Team), useValue: teamRepo },
      { provide: getRepositoryToken(Project), useValue: projectRepo },
      { provide: getRepositoryToken(User), useValue: userRepo },
      {
        provide: getRepositoryToken(UserOrganizationMembership),
        useValue: uomRepo,
      },
      { provide: getRepositoryToken(UserTeamMembership), useValue: utmRepo },
      {
        provide: getRepositoryToken(OrganizationInvitation),
        useValue: invRepo,
      },
      { provide: TeamService, useValue: teamService },
      { provide: MailService, useValue: mailService },
      { provide: Logger, useValue: logger },
      { provide: AuthorizationService, useValue: authorizationService },
      { provide: IDENTITY_PROVIDER_PORT, useValue: identity },
      { provide: ENTITLEMENTS_PORT, useValue: entitlements },
      { provide: ORGANIZATION_LIFECYCLE_HOOKS, useValue: lifecycleHooks },
      // MEMBER_PRODUCTS_PORT: the community binding unless a spec binds
      // another one.
      ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
      // ORGANIZATION_PROFILE_PORT: the community binding unless a spec binds
      // another one.
      ...ORGANIZATION_PROFILE_COMMUNITY_BINDINGS,
      {
        provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
        useValue: { getService: () => ({ deleteIntegrationsForOrg }) },
      },
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: DataPurgeLedger, useValue: purgeLedger },
      { provide: DataPurgeRunner, useValue: purgeRunner },
      { provide: OrganizationDeletionCodeService, useValue: deletionCodes },
      { provide: RealtimeEventPublisher, useValue: realtimePublisher },
      // Later entries override earlier ones with the same `provide`.
      ...(options.providers ?? []),
    ],
  }).compile();

  const service = module.get<OrganizationService>(OrganizationService);
  // Whichever member access port is bound (the community one by default).
  const memberProducts = module.get<MemberProductsPort>(MEMBER_PRODUCTS_PORT);

  return {
    module,
    service,
    orgRepo,
    teamRepo,
    projectRepo,
    userRepo,
    uomRepo,
    utmRepo,
    invRepo,
    mailService,
    teamService,
    authorizationService,
    entitlements,
    dataSource,
    purgeLedger,
    purgeRunner,
    deletionCodes,
    realtimePublisher,
    deleteIntegrationsForOrg,
    identity,
    lifecycleHooks,
    memberProducts,
    logger,
  };
}

export type OrganizationFixture = Awaited<
  ReturnType<typeof buildOrganizationService>
>;
