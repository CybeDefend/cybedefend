import type { Scan } from 'src/entities/scan.entity';
import type {
  ProjectScanSettings,
  StartScanRequest,
  StartScanResponse,
} from '@grpc/security-scanning/scan';

export const AI_ANALYSIS_PORT = 'AI_ANALYSIS_PORT';

/**
 * How security-scanning ends an agent container. `completed` for a skip,
 * `failed` for an interruption or a failure: the agent is optional, so the
 * scan state is decided by the scanners either way.
 */
export interface AgentCloseOutcome {
  status: 'completed' | 'failed';
  /** A code of a closed vocabulary, e.g. `nothing_to_analyze`. */
  outcomeReason: string;
  /** Fixed and user-safe: the dashboard renders it. Never raw error text. */
  step: string;
}

/**
 * What one tick of the AI queue did.
 */
export interface AgentQueueTickResult {
  /** Agent containers this tick closed: a budget past, nothing to analyse. */
  closed: number;
  /** Agent containers this tick stamped queued for AI (`analysisQueuedAt`). */
  queued: number;
  /** Analyses this tick claimed and started. */
  started: number;
}

export interface AiAnalysisPort {
  /**
   * After a code scan's scanner pods were launched. Never rejects.
   * Community: resolves, creates no agent row.
   */
  triggerAgentIngestion(
    scan: Scan,
    fileUrl: string,
    project: ProjectScanSettings,
  ): Promise<void>;
  /**
   * StartScan of a graph-only scan. Community: throws FAILED_PRECONDITION
   * SCANNERS_NOT_AVAILABLE.
   */
  startGraphOnlyScan(
    scan: Scan,
    request: StartScanRequest,
  ): Promise<StartScanResponse>;
  /**
   * One tick of the AI queue. Community: { closed: 0, queued: 0, started: 0 }.
   */
  runAgentAnalysisQueue(): Promise<AgentQueueTickResult>;
  /** Close an agent container. Community: false. */
  closeAgentContainer(
    scanId: string,
    containerId: string,
    outcome: AgentCloseOutcome,
  ): Promise<boolean>;
}
