import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, Project])],
  controllers: [MailController],
  providers: [MailService],
  // LocalAuthModule (community only) sends the welcome mail and asks
  // whether SMTP is configured.
  exports: [MailService],
})
export class MailModule {}
