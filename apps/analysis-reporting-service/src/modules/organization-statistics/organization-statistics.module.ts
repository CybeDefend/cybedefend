import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrpcModule } from '@grpc/grpc.module';
import { OrganizationStatisticsEntity } from 'src/entities/organization-statistics.entity';
import { OrganizationStatisticsRepository } from './organization-statistics.repository';
import { OrganizationStatisticsEnqueuer } from './organization-statistics.enqueuer';
import { OrganizationStatisticsService } from './organization-statistics.service';

/**
 * Persistence + debounce trigger for the org-wide home KPI cards. The
 * ORG_STATISTICS_RECOMPUTE BullMQ queue is registered centrally in the @Global
 * ScanQueueModule (so @InjectQueue resolves here without a local
 * registerQueue). Deliberately does NOT import ResultModule — the org-wide
 * aggregation is run by the caller (recompute processor / read-path
 * controller) to avoid a module cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrganizationStatisticsEntity]),
    GrpcModule.register(),
  ],
  providers: [
    OrganizationStatisticsRepository,
    OrganizationStatisticsEnqueuer,
    OrganizationStatisticsService,
  ],
  exports: [OrganizationStatisticsService, OrganizationStatisticsRepository],
})
export class OrganizationStatisticsModule {}
