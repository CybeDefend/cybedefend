import { FactoryProvider, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScanUploadToken } from 'src/entities/scan-upload-token.entity';
import {
  CLUSTER_SCANNING_CONFIG,
  clusterScanningConfigProvider,
  type ClusterScanningConfig,
} from './cluster-scanning.config';
import {
  COMMUNITY_KUBE_CLIENT,
  createCommunityKubeClient,
  type CommunityKubeClient,
} from './kube-client';
import { ClusterScanningState } from './cluster-scanning.state';
import { CommunityScannerCatalogue } from './scanner-catalogue';
import { ClusterPodLauncher } from './cluster-pod-launcher';
import { ClusterScannerOrchestrator } from './cluster-scanner-orchestrator';
import { ClusterScanQueue } from './cluster-scan-queue';
import { ClusterPodWatchdog } from './cluster-pod-watchdog';
import { ClusterScanEnd } from './cluster-scan-end';
import { ScanCapabilitiesController } from './scan-capabilities.controller';
import { ScanCoreModule } from '../scan/scan-core.module';
import { ScanModule } from '../scan/scan.module';
import { ScanResultsController } from '../scan/cluster-results/scan-results.controller';
import { ScanResultsService } from '../scan/cluster-results/scan-results.service';
import { ScanUploadTokens } from '../scan/cluster-results/scan-upload-tokens';

/** The engine's Kubernetes client; null when import-only (no configuration). */
export const communityKubeClientProvider: FactoryProvider<CommunityKubeClient | null> =
  {
    provide: COMMUNITY_KUBE_CLIENT,
    useFactory: (config: ClusterScanningConfig | null) =>
      config ? createCommunityKubeClient(config) : null,
    inject: [CLUSTER_SCANNING_CONFIG],
  };

/**
 * The Community cluster engine. Community-only: listed in
 * src/edition/community-bindings.ts COMMUNITY_ONLY_MODULES, so the cloud's
 * module graph never holds it and the cloud serves no ClusterScanService.
 * Global, so the edition
 * facades can inject what it exports.
 *
 * The catalogue (seeded once per process, before the first launch),
 * the pod launcher, the orchestrator the Community scanner-orchestrator
 * facade delegates to while enabled, and the 15 s queue tick (a @Cron, so it
 * fires in the cron process only: CronAppModule imports AppModule plus
 * ScheduleModule). Nothing the facades inject depends on ScanService, which
 * injects them (no constructor cycle).
 *
 * The watchdog (every minute, cron process only); the Community
 * scanner-pods facade releases pods through the exported client.
 *
 * The per-container upload tokens, the scanner
 * results service and its ClusterScanService controller are registered here
 * only, never in core ScanModule. ScanResultsService is exported (global) so
 * that ImportScanService resolves it @Optional() for a container's end of
 * import; in the cloud it is absent and such a request is refused.
 */
@Global()
@Module({
  imports: [
    ScanCoreModule,
    ScanModule,
    TypeOrmModule.forFeature([ScanUploadToken]),
  ],
  controllers: [ScanCapabilitiesController, ScanResultsController],
  providers: [
    clusterScanningConfigProvider,
    communityKubeClientProvider,
    ScanUploadTokens,
    ScanResultsService,
    ClusterScanningState,
    CommunityScannerCatalogue,
    ClusterScanEnd,
    ClusterPodLauncher,
    ClusterScannerOrchestrator,
    ClusterScanQueue,
    ClusterPodWatchdog,
  ],
  exports: [
    CLUSTER_SCANNING_CONFIG,
    COMMUNITY_KUBE_CLIENT,
    ClusterScanningState,
    ClusterScannerOrchestrator,
    ScanResultsService,
  ],
})
export class ClusterScanningModule {}
