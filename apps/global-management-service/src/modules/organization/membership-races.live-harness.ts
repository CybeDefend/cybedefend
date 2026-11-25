import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import type { DataSource } from 'typeorm';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

import { OrganizationService } from './organization.service';
import { OrganizationDeletionCodeService } from './organization-deletion-code.service';
import {
  communityEntitlementsMock,
  identityProviderMock,
  organizationLifecycleHooksMock,
} from './organization.service.fixtures';
import { TeamService } from '../team/team.service';
import { ProjectService } from '../project/project.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermifyService } from '../permify/permify.service';
import { MailService } from '../mail/mail.service';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { IDENTITY_PROVIDER_PORT } from 'src/edition/ports/identity-provider.port';
import { ORGANIZATION_LIFECYCLE_HOOKS } from 'src/edition/ports/organization-lifecycle.port';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from 'src/edition/community/member-products.binding';
import { ORGANIZATION_PROFILE_COMMUNITY_BINDINGS } from 'src/edition/community/organization-profile.binding';
import { Organization } from 'src/entities/organization.entity';
import { OrganizationInvitation } from 'src/entities/organization-invitation.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';

/** A short random pause: the permission engine is a network hop away. */
const hop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.random() * 4));

/**
 * An in-memory permission engine that records relation tuples
 * (`type:id#relation@subjectType:subjectId`) and answers the PermifyService
 * calls AuthorizationService makes. Every call yields first, like a network
 * call, so concurrent requests interleave between their reads and writes.
 *
 * A permission `check` is answered from the direct relation of that name,
 * except `team#add_user`, which this fake grants to anyone: the races below
 * are about the order of writes, not about who may act.
 */
export class InMemoryPermify {
  readonly tuples = new Set<string>();

  private key(type: string, id: string, relation: string, subject: string) {
    return `${type}:${id}#${relation}@${subject}`;
  }

  /** The relations `subjectId` (a user) holds on `type:id`. */
  relationsOf(type: string, id: string, subjectId: string): string[] {
    const prefix = `${type}:${id}#`;
    const suffix = `@user:${subjectId}`;
    return [...this.tuples]
      .filter((t) => t.startsWith(prefix) && t.endsWith(suffix))
      .map((t) => t.slice(prefix.length, t.length - suffix.length))
      .sort();
  }

  async readRelationships(filter: {
    entity: { type: string; id: string };
    subject: { type: string; id: string };
  }): Promise<string[]> {
    await hop();
    const prefix = `${filter.entity.type}:${filter.entity.id}#`;
    const suffix = `@${filter.subject.type}:${filter.subject.id}`;
    return [...this.tuples]
      .filter((t) => t.startsWith(prefix) && t.endsWith(suffix))
      .map((t) => t.slice(prefix.length, t.length - suffix.length));
  }

  async writePermission(
    resourceId: string,
    subjectId: string,
    subjectType: string,
    resourceType: string,
    relation: string,
  ): Promise<boolean> {
    await hop();
    this.tuples.add(
      this.key(
        resourceType,
        resourceId,
        relation,
        `${subjectType}:${subjectId}`,
      ),
    );
    return true;
  }

  async deletePermission(
    resourceId: string,
    subjectId: string,
    subjectType: string,
    resourceType: string,
    relation: string,
  ): Promise<boolean> {
    await hop();
    this.tuples.delete(
      this.key(
        resourceType,
        resourceId,
        relation,
        `${subjectType}:${subjectId}`,
      ),
    );
    return true;
  }

  async deleteRelationsOfSubject(
    resourceType: string,
    resourceId: string,
    subjectType: string,
    subjectId: string,
    relations: readonly string[],
  ): Promise<boolean> {
    await hop();
    for (const relation of relations) {
      this.tuples.delete(
        this.key(
          resourceType,
          resourceId,
          relation,
          `${subjectType}:${subjectId}`,
        ),
      );
    }
    return true;
  }

  async deleteAllPermissions(
    resourceId: string,
    resourceType: string,
  ): Promise<boolean> {
    await hop();
    const prefix = `${resourceType}:${resourceId}#`;
    for (const t of [...this.tuples]) {
      if (t.startsWith(prefix)) this.tuples.delete(t);
    }
    return true;
  }

  async checkPermission(
    resourceId: string,
    subjectId: string,
    subjectType: string,
    resourceType: string,
    permission: string,
  ): Promise<boolean> {
    await hop();
    if (resourceType === 'team' && permission === 'add_user') return true;
    return this.tuples.has(
      this.key(
        resourceType,
        resourceId,
        permission,
        `${subjectType}:${subjectId}`,
      ),
    );
  }

  async setOrganizationProductAttributes(): Promise<boolean> {
    return true;
  }

  async writeMemberProductTuples(): Promise<void> {
    // The Community Edition writes no product tuple.
  }
}

export interface MembershipHarness {
  module: TestingModule;
  organizations: OrganizationService;
  teams: TeamService;
  permify: InMemoryPermify;
  mail: { sendOrganizationInviteEmail: jest.Mock };
}

/**
 * The real OrganizationService, TeamService and AuthorizationService on a
 * real database, with the in-memory permission engine above and the
 * Community bindings of the edition ports. Identity mirror, billing, mail,
 * purge and projects are doubles that do nothing.
 */
export async function buildMembershipHarness(
  dataSource: DataSource,
): Promise<MembershipHarness> {
  const permify = new InMemoryPermify();
  const mail = {
    sendOrganizationInviteEmail: jest.fn().mockResolvedValue(true),
  };
  const module = await Test.createTestingModule({
    providers: [
      OrganizationService,
      TeamService,
      AuthorizationService,
      { provide: PermifyService, useValue: permify },
      ...[
        Organization,
        OrganizationInvitation,
        Project,
        Team,
        User,
        UserOrganizationMembership,
        UserTeamMembership,
      ].map((entity) => ({
        provide: getRepositoryToken(entity),
        useValue: dataSource.getRepository(entity),
      })),
      { provide: getDataSourceToken(), useValue: dataSource },
      { provide: MailService, useValue: mail },
      { provide: ProjectService, useValue: {} },
      { provide: Logger, useValue: createLoggerMock() },
      { provide: IDENTITY_PROVIDER_PORT, useValue: identityProviderMock() },
      { provide: ENTITLEMENTS_PORT, useValue: communityEntitlementsMock() },
      {
        provide: ORGANIZATION_LIFECYCLE_HOOKS,
        useValue: organizationLifecycleHooksMock(),
      },
      ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
      ...ORGANIZATION_PROFILE_COMMUNITY_BINDINGS,
      { provide: DataPurgeLedger, useValue: {} },
      { provide: DataPurgeRunner, useValue: { kick: () => undefined } },
      { provide: OrganizationDeletionCodeService, useValue: {} },
      {
        provide: RealtimeEventPublisher,
        useValue: { publish: async () => undefined },
      },
    ],
  }).compile();
  return {
    module,
    organizations: module.get(OrganizationService),
    teams: module.get(TeamService),
    permify,
    mail,
  };
}

/** A user row. */
export async function createUser(
  dataSource: DataSource,
  label = 'member',
): Promise<User> {
  const repo = dataSource.getRepository(User);
  return repo.save(
    repo.create({
      id: randomUUID(),
      email: `${label}-${randomUUID()}@example.test`,
      firstName: label,
      lastName: 'Race',
      picture: '',
    } as Partial<User>),
  );
}
