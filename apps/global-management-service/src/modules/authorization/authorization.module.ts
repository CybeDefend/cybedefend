import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { PermifyModule } from 'src/modules/permify/permify.module';

@Module({
  imports: [PermifyModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
