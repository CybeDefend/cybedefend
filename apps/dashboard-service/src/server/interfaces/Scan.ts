

export interface StartScanResponseDto {
  success: boolean;
  scanId: string;
  message: string;
  detectedLanguages?: string[];
}

export interface ScanResponseDto {
  id: string;
  name: string;
  state: string;
  language: string[];
  projectId: string;
  private: boolean;
  initializerUserId?: string;
  createAt: Date;
  updatedAt: Date;
  scanType?: string;
  startTime?: Date;
  endTime?: Date;
  branch?: string;
  containers: ContainerDto[];
  progress: number;
  step: string;
  vulnerabilityDetected?: number;
  errorMessage?: string;
  errorCode?: number;
  errorCategory?: string;
  potpieProjectId?: string;
  /**
   * Where the scan really is. Sent by
   * the user-facing `GET /project/:projectId/scan/:scanId` once security-scanning
   * computes it; absent (or null) before that, and the page then falls back to
   * the containers.
   */
  pipeline?: ScanPipelineDto | null;
  /**
   * How much of the branch's git history the Secrets scan analysed. Filled by
   * the user-facing scan route when the scan has a branch; absent otherwise.
   */
  historyCoverage?: {
    complete: boolean;
    coveredSince?: string;
    gaps: { fromSha: string; toSha: string; fromDate?: string; toDate?: string }[];
    lastPassOutcome?: string;
  } | null;
  /**
   * What the upload filter left out of the archive the scanners read. Absent
   * (or null) on a scan with no upload and on a scan recorded before it was
   * kept.
   */
  uploadFilterSummary?: UploadFilterSummaryDto | null;
}

/** Files of an uploaded archive the scanners never read, by reason. */
export interface UploadFilterSummaryDto {
  scannerConfiguration: number;
  excludedPath: number;
  excludedType: number;
  unsafeName: number;
  gitMetadata: number;
  /**
   * The excluded folders holding the most files left out (at most 20), the
   * largest first. `name` is the path in the archive up to and including the
   * excluded folder (`web/build`). `gitMetadata` is recorded only: it is not
   * announced as files not scanned.
   */
  excludedFolders: { name: string; count: number }[];
}

/** Scanner containers of a scan, counted by status. */
export interface ScanPipelineScannerLaneDto {
  total: number;
  open: number;
  completed: number; // completed + completed_degraded
  failed: number;
}

/** The agent container of a scan, as a stage of the AI lane. */
export interface ScanPipelineAgentLaneDto {
  stage: string; // not_applicable | ingesting | waiting_for_scanners | queued_for_ai | analyzing | done | skipped | interrupted | failed
  outcomeReason?: string; // closed vocabulary, e.g. ai_queue_timeout
  aiQueuePosition?: number; // queued_for_ai: approximate, 1-based, platform-wide
  processed?: number;
  total?: number;
  stageSince?: string; // ISO date string
  stageDeadline?: string; // ISO date string, end of the current stage's time budget
}

export interface ScanPipelineDto {
  slotReleased: boolean;
  queuePosition?: number; // queued scans: 1-based, within the organization
  queueReason?: 'org_limit' | 'platform_limit' | 'starting' | string;
  // gRPC decodes an unset message field as null.
  scanners?: ScanPipelineScannerLaneDto | null;
  agent?: ScanPipelineAgentLaneDto | null;
}

// Container task/process running as part of the scan lifecycle.
// Reflects the new API payload shape.
export interface ContainerDto {
  id: string;
  status: string; // starting | running | completed | failed | ...
  createdAt: string; // ISO date string
  startedAt: string; // ISO date string or empty
  finishedAt: string; // ISO date string or empty
  scanId: string;
  step?: string; // may contain plain text or a JSON string like { kind: 'agent_progress', ... }
  image?: string; // image name (agent-service)
  podName?: string;
  scannerType?: string; // sast | sca | iac | secret | container | aibom; empty for the agent
  totalVulnerabilities?: number;
  processedVulnerabilities?: number;
  outcomeReason?: string; // agent containers: why the AI ended
  analysisQueuedAt?: string; // ISO date string, agent only
  analysisStartedAt?: string; // ISO date string, agent only
}

export interface ScanInfo {
  scanId: string;
  state: string;
  createAt: string;
  scanType: string;
  branch?: string;
}

export interface UploadFileResponse {
  url: string;
  scanId: string;
}

/** The answer to a container-scan start. */
export interface StartContainerScanResponse {
  success: boolean;
  scanId: string;
  message: string;
  detectedLanguages: string[];
}
