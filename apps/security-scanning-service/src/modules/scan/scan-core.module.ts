import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrpcModule } from '@grpc/grpc.module';

import { Scan } from '../../entities/scan.entity';
import { GitHistoryCursor } from '../../entities/git-history-cursor.entity';
import { GitHistoryCursorService } from './git-history/git-history-cursor.service';
import { Container } from '../../entities/container.entity';
import { Scanner } from 'src/entities/scanner.entity';
import { SupportedLanguage } from 'src/entities/supported-language.entity';
import { FileManagementService } from '../file/file-management.service';
import {
  OrganizationManager,
  ProjectAppsecMarker,
  ScanPipelineEvents,
  ScanProgressUtils,
  ScanStateManager,
  ScanStateStore,
  ScanUtils,
  ScanValidation,
} from './core';
import { ContainerScanBranchResolver } from './core/containerScanBranchResolver';

/**
 * The core primitives of the scan module: everything `ScanService` and the
 * scan cron share, minus the gRPC-facing lifecycle. `ScanModule` imports this
 * module and provides only `ScanService`; the closed edition's
 * implementations inject the primitives from here.
 *
 * The pod clean-up goes through SCANNER_PODS_PORT, the lifecycle hooks
 * through SCAN_LIFECYCLE_HOOKS, and CreateScan's write and StartScan through
 * SCANNER_ORCHESTRATOR_PORT; EditionModule provides each port in both
 * editions. This module therefore imports no closed module and provides no
 * closed class: the scan queue, the pod watchdog, the diff-scan sweep and the
 * scan cron belong to the closed edition (closed extension).
 */
const providers = [
  FileManagementService,
  ConfigService,
  ScanUtils,
  ScanProgressUtils,
  ScanStateManager,
  ScanValidation,
  OrganizationManager,
  ContainerScanBranchResolver,
  ScanStateStore,
  ScanPipelineEvents,
  ProjectAppsecMarker,
  GitHistoryCursorService,
];

@Module({
  imports: [
    ConfigModule.forRoot(),
    GrpcModule.register(),
    TypeOrmModule.forFeature([
      Scan,
      Container,
      Scanner,
      SupportedLanguage,
      GitHistoryCursor,
    ]),
  ],
  providers,
  exports: [...providers, TypeOrmModule, GrpcModule],
})
export class ScanCoreModule {}
