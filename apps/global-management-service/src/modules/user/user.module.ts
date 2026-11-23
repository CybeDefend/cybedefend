import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from '../../entities/user.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Organization } from 'src/entities/organization.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { Team } from 'src/entities/team.entity';
import { Project } from 'src/entities/project.entity';
import { GrpcModule } from '@grpc/grpc.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    TypeOrmModule.forFeature([Organization]),
    TypeOrmModule.forFeature([Team]),
    // Needed by getProfile to enumerate the user's accessible projects
    // across every org (one cross-org JOIN; same membership predicates
    // as ProjectService.getProjectsOrganization).
    TypeOrmModule.forFeature([Project]),
    ConfigModule.forRoot(),
    GrpcModule.register(),
  ],
  controllers: [UserController],
  providers: [UserService, MailService],
})
export class UserModule {}
