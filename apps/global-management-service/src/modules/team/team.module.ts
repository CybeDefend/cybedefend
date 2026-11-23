import { Module } from '@nestjs/common';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { Team } from '../../entities/team.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/entities/user.entity';
import { Organization } from 'src/entities/organization.entity';
import { ConfigModule } from '@nestjs/config';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { Project } from 'src/entities/project.entity';
import { ProjectService } from '../project/project.service';
import { GrpcModule } from '@grpc/grpc.module';
import { ProjectBranchIngestion } from 'src/entities/project-branch-ingestion.entity';
import { ArchivedBranch } from 'src/entities/archived-branch.entity';
import { ProjectSecurityContext } from 'src/entities/project-security-context.entity';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DataPurgeModule } from '../data-purge/data-purge.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Team]),
    TypeOrmModule.forFeature([User]),
    TypeOrmModule.forFeature([
      Project,
      ProjectBranchIngestion,
      ArchivedBranch,
      ProjectSecurityContext,
    ]),
    TypeOrmModule.forFeature([Organization]),
    TypeOrmModule.forFeature([UserTeamMembership]),
    ConfigModule.forRoot(),
    GrpcModule.register(),
    AuthorizationModule,
    DataPurgeModule,
  ],
  controllers: [TeamController],
  providers: [TeamService, ProjectService],
})
export class TeamModule {}
