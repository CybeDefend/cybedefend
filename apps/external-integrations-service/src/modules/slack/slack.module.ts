import { Module } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackController } from './slack.controller';
import { SlackMessageService } from './slack-message.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import { SlackChannelMapping } from '../../entities/slack-channel-mapping.entity';
import { GrpcModule } from '@grpc/grpc.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    GrpcModule.register(),
    TypeOrmModule.forFeature([SlackIntegration, SlackChannelMapping]),
  ],
  controllers: [SlackController],
  providers: [SlackService, SlackMessageService],
  exports: [SlackService],
})
export class SlackModule {}
