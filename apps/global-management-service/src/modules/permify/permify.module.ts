import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PermifyService } from './permify.service';

@Module({
  imports: [ConfigModule],
  providers: [PermifyService],
  exports: [PermifyService],
})
export class PermifyModule {}
