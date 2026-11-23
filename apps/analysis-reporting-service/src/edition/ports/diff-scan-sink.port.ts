import type {
  ScanAddResultRequest,
  VulnerabilityDtoRequest,
} from '@grpc/analysis-reporting/result';
import type { CatalogRule } from '../../modules/sast-iac/sast-iac.utils';

/**
 * Extension token: the closed diff-scan store that
 * SastIacService routes a diff scan's batches into, instead of the real
 * detection tables. Only an ee module supplies it (the ee
 * DiffScanFindingModule); when the token is absent — the
 * Community Edition — a diff scan fails loud with INTERNAL rather than
 * ingest into the real tables.
 */
export const DIFF_SCAN_SINK = 'DIFF_SCAN_SINK';

/** Who launched a diff scan, as recorded on the scan in security-scanning. */
export interface DiffScanLauncherInfo {
  initializerUserId?: string;
  /** Name the MCP client declared (`claude-code`, `cursor-vscode`…). */
  codingAgent?: string;
}

export interface DiffScanSink {
  /**
   * Store one kept batch of a diff scan. The sink derives the scanner
   * category itself (from the scanner name, else the docker image) and
   * forwards to the store with the severities the scan asked for
   * (`request.vulnerabilityType`).
   */
  ingestBatch(
    request: ScanAddResultRequest,
    kept: VulnerabilityDtoRequest[],
    keptRules: Map<string, CatalogRule>,
    scannerNameLowerCase: string,
  ): Promise<void>;
  /**
   * Recompute and upsert the durable per-scan summary at finalization
   * (Scan diff history).
   */
  upsertSummary(
    scanId: string,
    projectId: string,
    branch: string | undefined,
    scanTypeCsv: string | undefined,
    launcher: DiffScanLauncherInfo,
  ): Promise<void>;
}
