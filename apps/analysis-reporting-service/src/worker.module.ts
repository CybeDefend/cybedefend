import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { LoggerModule } from './core/logger/logger.module';
import { UtilsModule } from './core/utils/utils.module';
import { SecretsModule } from './core/secrets/secrets.module';
import SecretsService from './core/secrets/secrets.service';
import {
  buildTypeOrmOptions,
  resolveDbConnection,
} from './core/db/typeorm-options';
import { validationSchema } from './core/config/validation.schema';
import { ScanQueueModule } from './modules/scan-queue/scan-queue.module';
import { GrpcModule } from '@grpc/grpc.module';
import { RealtimePublisherModule } from '@cybedefend/realtime-publisher';
import { RealtimeBatchPublisher } from './core/realtime/realtime-batch-publisher.service';
import { ProjectOrgResolver } from './core/realtime/project-org-resolver.service';

// Processors
import { ScaQueueProcessor } from './modules/scan-queue/processors/sca-queue.processor';
import { SastIacQueueProcessor } from './modules/scan-queue/processors/sast-iac-queue.processor';
import { ContainerQueueProcessor } from './modules/scan-queue/processors/container-queue.processor';
import { CvssRecalculationQueueProcessor } from './modules/scan-queue/processors/cvss-recalculation-queue.processor';
// AgentReanalysisQueueProcessor is a closed module and
// is registered by EeWorkerModule.
import { CyberiskRecomputeQueueProcessor } from './modules/scan-queue/processors/cyberisk-recompute-queue.processor';
import { ScanEndEvaluationQueueProcessor } from './modules/scan-queue/processors/scan-end-evaluation-queue.processor';
import { ScanCompleteNotificationService } from './modules/scan-queue/scan-complete-notification.service';

// Services needed by processors
import { ScaService } from './modules/sca/sca.service';
import { SastIacService } from './modules/sast-iac/sast-iac.service';
import { SastIacUtilsService } from './modules/sast-iac/sast-iac.utils';
import { ContainerService } from './modules/container/container.service';
import { ResultService } from './modules/result/result.service';
import { CyberRiskModule } from './modules/cyber-risk/cyber-risk.module';
import { OrganizationStatisticsModule } from './modules/organization-statistics/organization-statistics.module';
import { OrganizationStatisticsQueueProcessor } from './modules/scan-queue/processors/org-statistics-queue.processor';
import { CyberiskStartupBackfillService } from './modules/cyber-risk/cyberisk-startup-backfill.service';
import { ProjectScoreSyncService } from './modules/cyber-risk/project-score-sync.service';
import { IssueIntegrationService } from './modules/vulnerability/issue-integration.service';
import { OrganizationOverviewService } from './modules/result/organization-overview.service';
import { OverviewCacheService } from './modules/result/overview-cache.service';
import { PriorityCalculatorService } from './modules/result/priority-calculator.service';
import { CvssRecalculationProcessor } from './modules/cvss/cvss-recalculation.processor';
import { CvssCalculatorService } from './modules/cvss/cvss-calculator.service';
import { CvssExplainerService } from './modules/cvss/cvss-explainer.service';
import { SecurityContextCacheService } from './modules/security-context/security-context-cache.service';
import { AsyncTaskStoreModule } from './core/realtime/async-task-store.module';
import { VulnBatchUpdateProcessor } from './modules/scan-queue/processors/vuln-batch-update.processor';
// The SARIF import (queue results-import).
import { ResultsImportProcessor } from './modules/results-import/results-import.processor';
import { ImportFileSource } from './modules/results-import/import-file.source';
import { CatalogueFallbackService } from './modules/results-import/catalogue-fallback.service';
// The advisories of an sca or container import.
import { AdvisoryFallbackService } from './modules/results-import/advisory-fallback.service';

// OSV Module for vulnerability matching

// EPSS Module for post-ingestion enrichment

// Report generation (per-project + aggregated) is consumed by the DEDICATED
// reports worker (worker-reports.module.ts) — Puppeteer renders must never
// share a heap with scan ingestion. This module deliberately registers no
// report processor.

// GitModule (unused by the worker's providers) is a closed module.
import { CryptoModule } from './core/crypto/crypto.module';

// Queue metrics HTTP endpoint — served by the worker on METRICS_PORT (default 9095)
import { QueueMetricsModule } from './modules/scan-queue/queue-metrics.module';

// Entities needed by services
import { CodeSnippet } from './entities/code-snippet.entity';
import { DataFlowItem } from './entities/data-flow-item.entity';
import { HistoryItem } from './entities/history-item.entity';
import { IacVulnerabilityDetections } from './entities/iac-vulnerability-detections.entity';
import { CicdVulnerabilityDetections } from './entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from './entities/secret-vulnerability-detections.entity';
import { SastVulnerabilityDetections } from './entities/sast-vulnerability-detections.entity';
import { ScaDetectedPackages } from './entities/sca-detected-packages.entity';
import { ScaVulnerabilityDetections } from './entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionHistory } from './entities/vulnerability-detection-history.entity';
import { CorrespondanceTable } from './entities/vulnerability/correspondance-table.entity';
import { Vulnerability } from './entities/vulnerability/vulnerability.entity';
import { ContainerDetectedImage } from './entities/container-detected-image.entity';
import { ContainerDetectedPackage } from './entities/container-detected-package.entity';
import { VulnerabilityDetectionsContainer } from './entities/container_vulnerability_detections.entity';
import { VulnerabilityOsv, VulnerabilityOsvAffected } from './entities/osv';
import { AutoFixRecord } from './entities/autofix-record.entity';
import { ScaAutoFixRecord } from './entities/sca-autofix-record.entity';
import { ScaLicenseOverride } from './entities/sca-license-override.entity';
import { EditionModule } from './edition/edition.module';
import { editionImportsFor } from './edition/edition-imports';

/**
 * Dedicated Worker module for BullMQ queue processing.
 *
 * This module runs in a SEPARATE PROCESS from the main gRPC server.
 * It has its own:
 * - Database connection pool
 * - Redis/BullMQ connection
 * - Queue processors
 * - Required services (ScaService, SastIacService, ContainerService, etc.)
 *
 * This architecture ensures that heavy queue processing doesn't block
 * the main gRPC server's event loop.
 *
 * Usage:
 *   WORKER_MODE=true node dist/src/worker.js
 */
@Module({
  imports: [
    SecretsModule,
    LoggerModule,
    UtilsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema,
    }),
    EditionModule.forRoot(),
    // Database connection - separate pool from main app
    TypeOrmModule.forRootAsync({
      // One options factory for MySQL and PostgreSQL
      // (src/core/db/typeorm-options.ts), today's object on MySQL.
      useFactory: async (
        secretsService: SecretsService,
        configService: ConfigService,
      ) =>
        buildTypeOrmOptions(
          await resolveDbConnection(secretsService, configService),
          { context: 'worker' },
        ),
      inject: [SecretsService, ConfigService],
    }),
    // Register entities for services
    TypeOrmModule.forFeature([
      Vulnerability,
      CorrespondanceTable,
      SastVulnerabilityDetections,
      VulnerabilityDetectionHistory,
      DataFlowItem,
      HistoryItem,
      ScaDetectedPackages,
      CodeSnippet,
      IacVulnerabilityDetections,
      CicdVulnerabilityDetections,
      SecretVulnerabilityDetections,
      ScaVulnerabilityDetections,
      ContainerDetectedImage,
      ContainerDetectedPackage,
      VulnerabilityDetectionsContainer,
      VulnerabilityOsv,
      VulnerabilityOsvAffected,
      AutoFixRecord,
      ScaAutoFixRecord,
      ScaLicenseOverride,
    ]),
    HttpModule,
    // gRPC clients for external service calls
    GrpcModule.register(),
    // OSV matching and EPSS enrichment come from EeAdvisoriesModule
    // (EeWorkerModule), behind the advisory tokens.
    // GitModule removed (no worker provider used it).
    // Encryption service for secret values
    CryptoModule,
    // BullMQ setup - provides ScanQueueService and queue connections
    ScanQueueModule,
    // Realtime publisher for SSE events
    RealtimePublisherModule.forRoot({
      realtimeRedisUrl:
        process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL!,
    }),
    // Required by ResultService for CybeRisk score computation
    CyberRiskModule,
    // Org-wide KPI cards: persistence + debounced recompute (the processor
    // below runs the org-wide aggregation via the worker's ResultService).
    OrganizationStatisticsModule,
    // WS-C: expose GET /internal/queue-metrics for KEDA autoscaling
    QueueMetricsModule,
    // Async task Redis store (wired to BullMQ redis client via ScanQueueService)
    AsyncTaskStoreModule,
    ...editionImportsFor('worker'),
  ],
  providers: [
    // Core services needed by processors
    ScaService,
    SastIacService,
    SastIacUtilsService,
    ContainerService,
    ResultService,
    PriorityCalculatorService,
    IssueIntegrationService,
    OrganizationOverviewService,
    // Redis-backed cache for org overview blocks; invalidated by
    // RealtimeBatchPublisher on every scan event so the dashboard always
    // sees fresh data after a debounced flush.
    OverviewCacheService,
    // Scan complete notification service
    ScanCompleteNotificationService,
    // CVSS recalculation dependencies
    CvssRecalculationProcessor,
    CvssCalculatorService,
    CvssExplainerService,
    // Security context cache — required by SastIacService + ResultService
    // to compute exploitability_stale flag in worker context.
    SecurityContextCacheService,
    // Coalesces VULNERABILITY_BATCH_APPENDED bursts (~6 events in 2s) into a
    // single trailing publish per (project, scan, scanner) so the dashboard
    // doesn't refetch six times in a row.
    RealtimeBatchPublisher,
    // Resolves projectId → organizationId so vuln-batch events can also be
    // routed to the org overview channel.
    ProjectOrgResolver,
    // Queue processors
    ScaQueueProcessor,
    SastIacQueueProcessor,
    ContainerQueueProcessor,
    CvssRecalculationQueueProcessor,
    // AgentReanalysisQueueProcessor is provided by EeWorkerModule.
    CyberiskRecomputeQueueProcessor,
    OrganizationStatisticsQueueProcessor,
    VulnBatchUpdateProcessor,
    // Delayed re-evaluation of a scan's end after a scanner
    // was given up.
    ScanEndEvaluationQueueProcessor,
    // SARIF imports, a Community Edition feature. Idle elsewhere: ImportResults refuses every import
    // there, and a job found on the queue anyway is ended failed with
    // IMPORT_TYPE_NOT_AVAILABLE before its file is read.
    ResultsImportProcessor,
    ImportFileSource,
    CatalogueFallbackService,
    AdvisoryFallbackService,
    // Self-healing backfill of missing project scores at worker
    // startup (worker process only — resolves CyberiskRecomputeEnqueuer from
    // the imported CyberRiskModule and the DataSource from the worker TypeOrm).
    CyberiskStartupBackfillService,
    // Pushes recomputed scores to global-management's denormalized sort
    // key — per-recompute push (from the processor) + a worker-boot backfill.
    ProjectScoreSyncService,
    // Injection tokens for processors
    {
      provide: 'SCA_SERVICE',
      useExisting: ScaService,
    },
    {
      provide: 'SAST_IAC_SERVICE',
      useExisting: SastIacService,
    },
    {
      provide: 'CONTAINER_SERVICE',
      useExisting: ContainerService,
    },
    {
      provide: 'CVSS_RECALCULATION_PROCESSOR',
      useExisting: CvssRecalculationProcessor,
    },
    {
      provide: 'RESULT_SERVICE',
      useExisting: ResultService,
    },
  ],
})
export class WorkerModule {}
