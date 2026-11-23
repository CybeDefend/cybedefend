import type { Scan } from 'src/entities/scan.entity';
import type {
  CreateScanRequest,
  StartScanRequest,
  StartScanResponse,
} from '@grpc/security-scanning/scan';

export const SCANNER_ORCHESTRATOR_PORT = 'SCANNER_ORCHESTRATOR_PORT';

/** gRPC FAILED_PRECONDITION message: the Community Edition runs no scanner pods. */
export const SCANNERS_NOT_AVAILABLE = 'SCANNERS_NOT_AVAILABLE';

/** gRPC FAILED_PRECONDITION message: no scanner would run for this project. */
export const NO_SCANNER_ENABLED = 'NO_SCANNER_ENABLED';

export interface ScannerOrchestratorPort {
  /**
   * CheckExistingScan, which every start route runs before it signs an
   * upload URL: refuses a project for which no scanner would run, so the
   * scan is refused before its upload instead of completing with none.
   * `scanType` is the kind of scan about to start (absent: a code scan).
   * Community with its cluster engine running: FAILED_PRECONDITION
   * NO_SCANNER_ENABLED when none of the project's enabled scan types has a
   * scanner. Community without it, and cloud: returns.
   */
  assertProjectScannable(projectId: string, scanType?: string): Promise<void>;
  /**
   * CreateScan of a scan that is not an import scan, before any write.
   * Community: throws FAILED_PRECONDITION SCANNERS_NOT_AVAILABLE.
   * Cloud: returns.
   */
  assertScanSupported(request: CreateScanRequest): void;
  /**
   * CreateScan: writes the row of a non-import scan (diff quota, graph-only
   * limits, plain save). Community: throws the refusal.
   */
  saveNewScan(scan: Scan): Promise<void>;
  /**
   * StartScan of a non-import scan, after the not-found and cancelled
   * guards. Community: throws the refusal. Cloud: today's start.
   */
  startScan(scan: Scan, request: StartScanRequest): Promise<StartScanResponse>;
}
