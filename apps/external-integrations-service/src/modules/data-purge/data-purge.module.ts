import { Module } from '@nestjs/common';
import { LoggerModule } from '../../core/logger/logger.module';
import { IntegrationsAdminModule } from '../integrations-admin/integrations-admin.module';
import { DataPurgeController } from './data-purge.controller';
import { DataPurgeService } from './data-purge.service';

/**
 * Purge of a deleted project's or organization's integration data. The
 * DataSource comes from the root TypeOrmModule.
 */
@Module({
  imports: [LoggerModule, IntegrationsAdminModule],
  controllers: [DataPurgeController],
  providers: [DataPurgeService],
})
export class DataPurgeModule {}
