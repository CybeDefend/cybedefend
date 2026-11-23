import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SastVulnerabilityDetections } from '../../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../../entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../../entities/container_vulnerability_detections.entity';
import { ScaDetectedPackages } from '../../../entities/sca-detected-packages.entity';
import { ScaLicenseOverride } from '../../../entities/sca-license-override.entity';
import { AggregatedReport } from '../../../entities/aggregated-report.entity';
import { Logger } from 'nestjs-pino';
import { AggregatedReportsService } from './aggregated-reports.service';
import { ReportAggregationService } from './services/report-aggregation.service';
import { ReportBuilderService } from './services/report-builder.service';
import { GrpcModule } from '@grpc/grpc.module';
import { ReportUploadModule } from '../shared/report-upload.module';

/**
 * Module for aggregated security reports (Organization, Team, Batch).
 * Handles report generation across multiple projects with different scopes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SastVulnerabilityDetections,
      IacVulnerabilityDetections,
      ScaVulnerabilityDetections,
      VulnerabilityDetectionsContainer,
      ScaDetectedPackages,
      ScaLicenseOverride,
      AggregatedReport,
    ]),
    GrpcModule.register(),
    ReportUploadModule,
  ],
  providers: [
    AggregatedReportsService,
    ReportAggregationService,
    ReportBuilderService,
    Logger,
  ],
  // ReportAggregationService: the project metadata the ee aggregated kinds
  // (AGGREGATED_REPORT_KINDS) build on.
  exports: [AggregatedReportsService, ReportAggregationService],
})
export class AggregatedReportsModule {}
