import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { OrganizationController } from './organization.controller';
import { Organization } from '../../entities/organization.entity';
import { OrganizationService } from './organization.service';
import { ConfigModule } from '@nestjs/config';
import { UserOrganizationMembership } from 'src/entities/user-organization-membership.entity';
import { OrganizationInvitation } from '../../entities/organization-invitation.entity';
import { MailModule } from 'src/modules/mail/mail.module';
import { MailService } from 'src/modules/mail/mail.service';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { TeamService } from '../team/team.service';
import { ProjectService } from '../project/project.service';
import { GrpcModule } from '@grpc/grpc.module';
import { ProjectBranchIngestion } from 'src/entities/project-branch-ingestion.entity';
import { ArchivedBranch } from 'src/entities/archived-branch.entity';
import { ProjectSecurityContext } from 'src/entities/project-security-context.entity';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DataPurgeModule } from '../data-purge/data-purge.module';
import { OrganizationDeletionCode } from 'src/entities/organization-deletion-code.entity';
import {
  ORGANIZATION_DELETION_CODE_STORE,
  OrganizationDeletionCodeService,
} from './organization-deletion-code.service';
import { MysqlOrganizationDeletionCodeStore } from './organization-deletion-code.store';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, OrganizationDeletionCode]),
    TypeOrmModule.forFeature([User]),
    TypeOrmModule.forFeature([UserOrganizationMembership]),
    TypeOrmModule.forFeature([OrganizationInvitation]),
    TypeOrmModule.forFeature([Team]),
    TypeOrmModule.forFeature([
      Project,
      ProjectBranchIngestion,
      ArchivedBranch,
      ProjectSecurityContext,
    ]),
    TypeOrmModule.forFeature([UserTeamMembership]),
    ConfigModule.forRoot(),
    GrpcModule.register(),
    MailModule,
    AuthorizationModule,
    DataPurgeModule,
  ],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    MailService,
    TeamService,
    ProjectService,
    OrganizationDeletionCodeService,
    {
      provide: ORGANIZATION_DELETION_CODE_STORE,
      useClass: MysqlOrganizationDeletionCodeStore,
    },
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
