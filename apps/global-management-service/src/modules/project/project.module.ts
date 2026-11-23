import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectController } from './project.controller';
import { Project } from '../../entities/project.entity';
import { ProjectBranchIngestion } from '../../entities/project-branch-ingestion.entity';
import { ArchivedBranch } from '../../entities/archived-branch.entity';
import { ProjectSecurityContext } from '../../entities/project-security-context.entity';
import { ProjectService } from './project.service';
import { User } from 'src/entities/user.entity';
import { ConfigModule } from '@nestjs/config';
import { Team } from 'src/entities/team.entity';
import { GrpcModule } from '@grpc/grpc.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DataPurgeModule } from '../data-purge/data-purge.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectBranchIngestion,
      ArchivedBranch,
      ProjectSecurityContext,
    ]),
    TypeOrmModule.forFeature([Team]),
    TypeOrmModule.forFeature([User]),
    ConfigModule.forRoot(),
    GrpcModule.register(),
    AuthorizationModule,
    DataPurgeModule,
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
})
export class ProjectModule {}
