import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SastIacService } from '../sast-iac/sast-iac.service';
import { ResultController } from './result.controller';
import { ConfigModule } from '@nestjs/config';
import { ScaService } from '../sca/sca.service';
import { ResultService } from './result.service';
import { OrganizationOverviewService } from './organization-overview.service';
import { HttpModule } from '@nestjs/axios';
import { SastIacUtilsService } from '../sast-iac/sast-iac.utils';
import { CodeSnippet } from 'src/entities/code-snippet.entity';
import { DataFlowItem } from 'src/entities/data-flow-item.entity';
import { HistoryItem } from 'src/entities/history-item.entity';
import { IacVulnerabilityDetections } from 'src/entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from 'src/entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from 'src/entities/secret-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from 'src/entities/sast-vulnerability-detections.entity';
import { ScaDetectedPackages } from 'src/entities/sca-detected-packages.entity';
import { ScaLicenseOverride } from 'src/entities/sca-license-override.entity';
import { ScaVulnerabilityDetections } from 'src/entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from 'src/entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from 'src/entities/vulnerability/correspondance-table.entity';
import { Vulnerability } from 'src/entities/vulnerability/vulnerability.entity';
import { GrpcModule } from '@grpc/grpc.module';
import { ContainerService } from '../container/container.service';
import { ContainerDetectedImage } from 'src/entities/container-detected-image.entity';
import { ContainerDetectedPackage } from 'src/entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from 'src/entities/container_vulnerability_detections.entity';
import {
  VulnerabilityOsv,
  VulnerabilityOsvAffected,
  VulnerabilityOsvAffectedEvent,
  VulnerabilityOsvAffectedRange,
  VulnerabilityOsvAlias,
  VulnerabilityOsvReference,
  VulnerabilityOsvSeverity,
} from 'src/entities/osv';
import { AutoFixRecord } from 'src/entities/autofix-record.entity';
import { ScaAutoFixRecord } from 'src/entities/sca-autofix-record.entity';
import { OwaspReportModule } from '../reports/owasp-report/owasp-report.module';
import { CweReportModule } from '../reports/cwe-report/cwe-report.module';
import { ReportUploadModule } from '../reports/shared/report-upload.module';
import { GeneratedReport } from 'src/entities/generated-report.entity';
import { ImportedAdvisory } from 'src/entities/imported-advisory.entity';
import { OwaspReport } from 'src/entities/owasp-report.entity';
import { CweReport } from 'src/entities/cwe-report.entity';
import { AggregatedReport } from 'src/entities/aggregated-report.entity';
import { AggregatedReportsModule } from '../reports/aggregated-reports/aggregated-reports.module';
import { IssueIntegrationService } from '../vulnerability/issue-integration.service';
import { GroupedVulnerabilityService } from '../grouped-vulnerability/grouped-vulnerability.service';
import { ScanCompleteNotificationService } from '../scan-queue/scan-complete-notification.service';
// ScaAutoFixService and GitModule are closed modules; the api context gets
// them from ScaAutoFixApiModule (EeApiModule).
// The ScaAutoFixRecord entity stays in forFeature below; the job entity is
// closed and registered by ScaAutoFixApiModule.
import { PolicyVulnerabilityService } from './policy-vulnerability.service';
import { PriorityCalculatorService } from './priority-calculator.service';
import { CvssModule } from '../cvss/cvss.module';
import { CryptoModule } from 'src/core/crypto/crypto.module';
import { SecretModule } from 'src/modules/secret/secret.module';
import { SecurityContextCacheService } from '../security-context/security-context-cache.service';
// ReanalyzeService is closed and provided by AgentReanalysisModule, imported by the ee context modules.
import { CyberRiskModule } from '../cyber-risk/cyber-risk.module';
import { OrganizationStatisticsModule } from '../organization-statistics/organization-statistics.module';
import { OverviewCacheService } from './overview-cache.service';
import { AsyncTaskStoreModule } from 'src/core/realtime/async-task-store.module';
import { ReportRetentionService } from '../reports/retention/report-retention.service';
import { ReportQuotaService } from '../reports/retention/report-quota.service';
import { ProjectReportEnqueuer } from '../reports/shared/project-report-enqueuer.service';
import { ProjectOrgResolver } from 'src/core/realtime/project-org-resolver.service';
import { DataPurgeModule } from '../data-purge/data-purge.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    GrpcModule.register(),
    TypeOrmModule.forFeature([
      Vulnerability,
      CorrespondanceTable,
      SastVulnerabilityDetections,
      VulnerabilityDetectionHistory,
      DataFlowItem,
      HistoryItem,
      ScaDetectedPackages,
      ScaLicenseOverride,
      CodeSnippet,
      IacVulnerabilityDetections,
      CicdVulnerabilityDetections,
      SecretVulnerabilityDetections,
      ScaVulnerabilityDetections,
      ContainerDetectedImage,
      ContainerDetectedPackage,
      VulnerabilityDetectionsContainer,
      // Every OSV entity, relation targets included: the API context
      // auto-loads only what a forFeature registers, and the Community
      // Edition does not load the closed OSV sync module that registers
      // them elsewhere.
      VulnerabilityOsv,
      VulnerabilityOsvAlias,
      VulnerabilityOsvReference,
      VulnerabilityOsvSeverity,
      VulnerabilityOsvAffected,
      VulnerabilityOsvAffectedRange,
      VulnerabilityOsvAffectedEvent,
      // The advisory content a project imported: every list and detail of
      // dependency and container findings reads it next to the catalogue.
      ImportedAdvisory,
      AutoFixRecord,
      ScaAutoFixRecord,
      OwaspReport,
      CweReport,
      AggregatedReport,
      GeneratedReport,
    ]),
    HttpModule,
    OwaspReportModule,
    CweReportModule,
    AggregatedReportsModule,
    ReportUploadModule,
    CvssModule,
    CryptoModule,
    SecretModule,
    CyberRiskModule,
    OrganizationStatisticsModule, // org-wide KPI cards persistence + dirty trigger
    AsyncTaskStoreModule, // async task gRPC handlers (Task 1.5)
    DataPurgeModule, // the legacy project delete runs the complete purge
  ],
  providers: [
    SastIacService,
    SastIacUtilsService,
    ScaService,
    ContainerService,
    ResultService,
    OrganizationOverviewService,
    // OwaspReportService / CweReportService are provided by their
    // own modules (Owasp/CweReportModule, imported above). Each encapsulates a
    // ProjectNameResolver dependency private to that module, so re-declaring the
    // service here as a bare provider fails DI. EuAiActReportModule,
    // ScannerTypeReportModule, SbomModule and the SbomReport entity are
    // closed and imported by EeApiModule / EeWorkerReportsModule.
    IssueIntegrationService,
    GroupedVulnerabilityService,
    ScanCompleteNotificationService,
    PolicyVulnerabilityService,
    PriorityCalculatorService,
    SecurityContextCacheService,
    OverviewCacheService,
    ProjectOrgResolver, // Resolve projectId→orgId for report retention
    ReportRetentionService, // Plan-derived report expiry
    ReportQuotaService, // Stored-report fair-usage quota
    ProjectReportEnqueuer, // Premium-report enqueue (core + ee handlers)
  ],
  exports: [
    ResultService,
    OrganizationOverviewService,
    SastIacService,
    SastIacUtilsService,
    IssueIntegrationService,
    GroupedVulnerabilityService,
    ScaService,
    ContainerService,
    PriorityCalculatorService,
    SecurityContextCacheService,
    OverviewCacheService,
    ProjectReportEnqueuer,
  ],
  controllers: [ResultController],
})
export class ResultModule {}
