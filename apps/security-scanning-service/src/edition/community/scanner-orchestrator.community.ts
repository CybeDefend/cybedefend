import { Injectable, Optional } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { Scan } from 'src/entities/scan.entity';
import type {
  CreateScanRequest,
  StartScanRequest,
  StartScanResponse,
} from '@grpc/security-scanning/scan';
import type { ScannerOrchestratorPort } from '../ports/scanner-orchestrator.port';
import { SCANNERS_NOT_AVAILABLE } from '../ports/scanner-orchestrator.port';
import { ClusterScannerOrchestrator } from '../../modules/cluster-scanning/cluster-scanner-orchestrator';
import { ClusterScanningState } from '../../modules/cluster-scanning/cluster-scanning.state';

function scannersNotAvailable(): RpcException {
  return new RpcException({
    code: status.FAILED_PRECONDITION,
    message: SCANNERS_NOT_AVAILABLE,
  });
}

/**
 * The Community ScannerOrchestratorPort. While the cluster engine
 * (ClusterScanningModule, global, Community only) is present and enabled, a
 * code scan goes to ClusterScannerOrchestrator. Otherwise: every non-import scan is refused
 * SCANNERS_NOT_AVAILABLE before any row is written, at CreateScan
 * (`assertScanSupported`, `saveNewScan`) and at StartScan (`startScan`).
 * Import scans never come here (ImportScanService).
 */
@Injectable()
export class CommunityScannerOrchestrator implements ScannerOrchestratorPort {
  constructor(
    @Optional() private readonly engine?: ClusterScannerOrchestrator,
    @Optional() private readonly state?: ClusterScanningState,
  ) {}

  private enabledEngine(): ClusterScannerOrchestrator | null {
    return this.engine && this.state?.enabled ? this.engine : null;
  }

  async assertProjectScannable(
    projectId: string,
    scanType?: string,
  ): Promise<void> {
    // Without a running engine, CreateScan refuses every code scan anyway.
    await this.enabledEngine()?.assertProjectScannable(projectId, scanType);
  }

  assertScanSupported(request: CreateScanRequest): void {
    const engine = this.enabledEngine();
    if (!engine) throw scannersNotAvailable();
    engine.assertScanSupported(request);
  }

  async saveNewScan(scan: Scan): Promise<void> {
    const engine = this.enabledEngine();
    if (!engine) throw scannersNotAvailable();
    await engine.saveNewScan(scan);
  }

  async startScan(
    scan: Scan,
    request: StartScanRequest,
  ): Promise<StartScanResponse> {
    const engine = this.enabledEngine();
    if (!engine) throw scannersNotAvailable();
    return engine.startScan(scan, request);
  }
}
