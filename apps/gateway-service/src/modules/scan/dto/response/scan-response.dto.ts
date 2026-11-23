// src/global-management/scan/response/container.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsDateString,
} from 'class-validator';

export class ContainerDto {
  @IsUUID()
  id: string;

  @IsString()
  status: string;

  @IsDateString()
  createdAt: Date;

  @IsDateString()
  startedAt: Date;

  @IsDateString()
  finishedAt: Date;

  @IsString()
  scanId: string;

  // Scan pipeline: what the Results page reads to
  // show where the scan is.
  @ApiPropertyOptional({
    description:
      'Scanner type (sast, sca, iac, secret, container, aibom); empty for the AI agent',
    type: 'string',
    example: 'sast',
  })
  @IsOptional()
  @IsString()
  scannerType?: string;

  @ApiPropertyOptional({
    description: 'Findings the container has to process',
    type: 'integer',
    example: 165,
  })
  @IsOptional()
  @IsInt()
  totalVulnerabilities?: number;

  @ApiPropertyOptional({
    description:
      'Findings processed so far. For the AI agent: the findings it analysed',
    type: 'integer',
    example: 45,
  })
  @IsOptional()
  @IsInt()
  processedVulnerabilities?: number;

  @ApiPropertyOptional({
    description:
      'Why the container ended, as a code (for example parse_timeout, analysis_timeout, scanner_timeout). New codes may appear.',
    type: 'string',
    example: 'parse_timeout',
  })
  @IsOptional()
  @IsString()
  outcomeReason?: string;

  @ApiPropertyOptional({
    description: 'AI agent only: when it became eligible for an AI slot',
    type: 'string',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  analysisQueuedAt?: string;

  @ApiPropertyOptional({
    description: 'AI agent only: when its analysis started',
    type: 'string',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  analysisStartedAt?: string;

  constructor(
    id: string,
    status: string,
    createdAt: Date,
    startedAt: Date,
    finishedAt: Date,
    scanId: string,
  ) {
    this.id = id;
    this.status = status;
    this.createdAt = createdAt;
    this.startedAt = startedAt;
    this.finishedAt = finishedAt;
    this.scanId = scanId;
  }

  public toString(): string {
    return JSON.stringify({
      id: this.id,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      scanId: this.scanId,
    });
  }
}

/** Valid states for a scan */
export enum ScanState {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** Stages of the AI agent. */
const AGENT_STAGES = [
  'not_applicable',
  'ingesting',
  'waiting_for_scanners',
  'queued_for_ai',
  'analyzing',
  'done',
  'skipped',
  'interrupted',
  'failed',
];

/** Why a queued scan waits. */
const QUEUE_REASONS = ['org_limit', 'platform_limit', 'starting'];

/** The scanner containers of a scan, by status. */
export class ScannerLaneDto {
  @ApiProperty({ description: 'Scanner containers', type: 'integer' })
  @IsInt()
  total: number;

  @ApiProperty({
    description: 'Scanner containers still open (queued, starting, running)',
    type: 'integer',
  })
  @IsInt()
  open: number;

  @ApiProperty({
    description: 'Scanner containers that completed, degraded ones included',
    type: 'integer',
  })
  @IsInt()
  completed: number;

  @ApiProperty({
    description: 'Scanner containers that failed',
    type: 'integer',
  })
  @IsInt()
  failed: number;
}

/** The AI analysis of a scan (its agent container). */
export class AgentLaneDto {
  @ApiProperty({
    description:
      'Stage of the AI analysis: not_applicable when the scan has no AI analysis; ingesting, waiting_for_scanners, queued_for_ai and analyzing while it runs; done, skipped, interrupted or failed once it ended',
    enum: AGENT_STAGES,
    example: 'analyzing',
  })
  @IsIn(AGENT_STAGES)
  stage: string;

  @ApiPropertyOptional({
    description:
      'Why the AI analysis ended, as a code (for example nothing_to_analyze, quota_exhausted, parse_timeout, ai_queue_timeout, analysis_timeout, analysis_failed, service_unavailable). New codes may appear.',
    type: 'string',
    example: 'ai_queue_timeout',
  })
  @IsOptional()
  @IsString()
  outcomeReason?: string;

  @ApiPropertyOptional({
    description:
      'Stage queued_for_ai: approximate 1-based place in the AI analysis queue, platform-wide',
    type: 'integer',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  aiQueuePosition?: number;

  @ApiPropertyOptional({
    description: 'Findings analysed so far',
    type: 'integer',
    example: 45,
  })
  @IsOptional()
  @IsInt()
  processed?: number;

  @ApiPropertyOptional({
    description: 'Findings to analyse',
    type: 'integer',
    example: 165,
  })
  @IsOptional()
  @IsInt()
  total?: number;

  @ApiPropertyOptional({
    description: 'When the current stage began',
    type: 'string',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  stageSince?: string;

  @ApiPropertyOptional({
    description: 'When the time limit of the current stage ends',
    type: 'string',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  stageDeadline?: string;
}

/** Where a scan really is. */
export class ScanPipelineDto {
  @ApiProperty({
    description:
      "Running scan whose scanners are all done: its AI analysis goes on in the background and the scan no longer counts against the organization's concurrent scan limit",
    type: 'boolean',
  })
  @IsBoolean()
  slotReleased: boolean;

  @ApiPropertyOptional({
    description: "Queued scan: 1-based position in the organization's queue",
    type: 'integer',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  queuePosition?: number;

  @ApiPropertyOptional({
    description:
      "Queued scan: why it waits. org_limit: the organization's concurrent scans are running; platform_limit: the platform is at capacity; starting: it is about to start",
    enum: QUEUE_REASONS,
    example: 'org_limit',
  })
  @IsOptional()
  @IsIn(QUEUE_REASONS)
  queueReason?: string;

  @ApiProperty({
    description: 'The scanner containers, by status',
    type: () => ScannerLaneDto,
  })
  @IsObject()
  scanners: ScannerLaneDto;

  @ApiProperty({
    description: 'The AI analysis',
    type: () => AgentLaneDto,
  })
  @IsObject()
  agent: AgentLaneDto;
}

export class GitHistoryGapDto {
  @ApiProperty({ description: 'Oldest commit of the unscanned range' })
  @IsString()
  fromSha: string;

  @ApiProperty({ description: 'Newest commit of the unscanned range' })
  @IsString()
  toSha: string;

  @ApiPropertyOptional({ description: 'ISO-8601 date of the oldest commit' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 date of the newest commit' })
  @IsOptional()
  @IsString()
  toDate?: string;
}

export class GitHistoryPassDto {
  @ApiProperty({
    description:
      'What the scan did about the git history: full, partial, incremental, incremental_with_gap or none',
    example: 'incremental',
  })
  @IsString()
  mode: string;

  @ApiPropertyOptional({ description: 'Tip commit the pass scanned up to' })
  @IsOptional()
  @IsString()
  tipSha?: string;

  @ApiPropertyOptional({
    description: 'Cursor tip the pass started from; absent on a first pass',
  })
  @IsOptional()
  @IsString()
  baseTipSha?: string;

  @ApiProperty({
    description: 'Revisions the secret scanner excluded',
    type: [String],
  })
  @IsArray()
  excludeShas: string[];

  @ApiPropertyOptional({
    description: 'ISO-8601 committer date of the oldest commit scanned',
  })
  @IsOptional()
  @IsString()
  oldestCommitAt?: string;

  @ApiProperty({
    description: 'Size of the scanned history in bytes, as a decimal string',
  })
  @IsString()
  bytes: string;

  @ApiPropertyOptional({
    description: 'The range this pass left unscanned, if any',
    type: () => GitHistoryGapDto,
  })
  @IsOptional()
  @IsObject()
  gap?: GitHistoryGapDto;

  @ApiProperty({ description: 'Whether this was the first pass of the branch' })
  @IsBoolean()
  firstPass: boolean;

  @ApiProperty({
    description: 'The repository the pass ran on',
    example: 'github:owner/repo',
  })
  @IsString()
  repositoryKey: string;
}

export class GitHistoryCoverageDto {
  @ApiProperty({
    description: 'Whether the whole history of the branch is covered',
  })
  @IsBoolean()
  complete: boolean;

  @ApiPropertyOptional({
    description: 'ISO-8601 date since which the history is covered',
  })
  @IsOptional()
  @IsString()
  coveredSince?: string;

  @ApiProperty({
    description: 'Ranges of the history that were never scanned',
    type: () => GitHistoryGapDto,
    isArray: true,
  })
  @IsArray()
  gaps: GitHistoryGapDto[];

  @ApiPropertyOptional({
    description: 'Outcome of the last pass: ok or failed',
    example: 'ok',
  })
  @IsOptional()
  @IsString()
  lastPassOutcome?: string;
}

export class ScanResponseDto {
  @ApiProperty({ description: 'Scan unique identifier', format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Name of the scan', type: 'string' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Current scan state',
    enum: ScanState,
  })
  @IsEnum(ScanState)
  state: string;

  @ApiProperty({
    description: 'Array of detected or target languages',
    isArray: true,
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  language: string[];

  @ApiProperty({ description: 'Project unique identifier', format: 'uuid' })
  @IsString()
  projectId: string;

  @ApiProperty({
    description: 'Define if the scan is private',
    type: 'boolean',
  })
  @IsBoolean()
  private: boolean;

  @ApiProperty({
    description: 'User ID who initialized the scan',
    format: 'uuid',
    required: false,
  })
  @IsOptional()
  @IsString()
  initializerUserId?: string;

  @ApiProperty({
    description: 'Creation date of the scan',
    type: 'string',
    format: 'date-time',
  })
  @IsDate()
  createAt: Date;

  @ApiProperty({
    description: 'Last update date of the scan',
    type: 'string',
    format: 'date-time',
  })
  @IsDate()
  updatedAt: Date;

  @ApiProperty({
    description: 'Scan type (optional)',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  scanType?: string;

  @ApiProperty({
    description: 'Date and time when the scan started',
    required: false,
    format: 'date-time',
  })
  @IsOptional()
  @IsDate()
  startTime?: Date;

  @ApiProperty({
    description: 'Date and time when the scan ended',
    required: false,
    format: 'date-time',
  })
  @IsOptional()
  @IsDate()
  endTime?: Date;

  @ApiProperty({
    description: 'Array of containers used or involved in this scan',
    isArray: true,
    type: () => [ContainerDto],
  })
  @IsArray()
  containers: ContainerDto[];

  @ApiProperty({
    description: 'Progress of the scan in percentage (0-100)',
    type: 'number',
  })
  @IsNumber()
  progress: number;

  @ApiProperty({ description: 'Current step of the scan', type: 'string' })
  @IsString()
  step: string;

  @ApiProperty({
    description: 'Number of vulnerabilities detected (optional)',
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  vulnerabilityDetected?: number;

  @ApiProperty({
    description: 'Error message when scan fails',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  errorMessage?: string;

  @ApiProperty({
    description:
      'Exit code from the scanner (see scanlink-error-codes.ts for reference)',
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  errorCode?: number;

  @ApiProperty({
    description:
      'Error category: authentication, cloud_provider, network, scan, api, import, unknown',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  errorCategory?: string;

  @ApiPropertyOptional({
    description:
      'Import scans only: the format of the imported file (sarif). Absent on any other scan.',
    type: 'string',
    example: 'sarif',
  })
  @IsOptional()
  @IsString()
  importFormat?: string;

  @ApiPropertyOptional({
    description:
      'Import scans only: the tools the imported file came from, comma-separated, once the results are processed.',
    type: 'string',
    example: 'semgrep,codeql',
  })
  @IsOptional()
  @IsString()
  importTool?: string;

  @ApiPropertyOptional({
    description:
      'Where the scan really is: its place in the queue, its scanners and its AI analysis. Absent while security-scanning does not compute it.',
    type: () => ScanPipelineDto,
  })
  @IsOptional()
  @IsObject()
  pipeline?: ScanPipelineDto;

  @ApiPropertyOptional({
    description:
      'What this scan did about the git history of its branch. Absent when the scan did not scan history.',
    type: () => GitHistoryPassDto,
  })
  @IsOptional()
  @IsObject()
  historyPass?: GitHistoryPassDto;

  @ApiPropertyOptional({
    description:
      'How much of the history of the scan branch has been scanned so far. Absent when no cursor exists.',
    type: () => GitHistoryCoverageDto,
  })
  @IsOptional()
  @IsObject()
  historyCoverage?: GitHistoryCoverageDto;

  constructor(
    id: string,
    name: string,
    state: string,
    language: string[],
    projectId: string,
    privateScan: boolean,
    initializerUserId: string,
    createAt: Date,
    updatedAt: Date,
    scanType: string,
    startTime: Date,
    endTime: Date,
    containers: ContainerDto[],
    progress: number,
    step: string,
    vulnerabilityDetected: number,
    errorMessage?: string,
    errorCode?: number,
    errorCategory?: string,
  ) {
    this.id = id;
    this.name = name;
    this.state = state;
    this.language = language;
    this.projectId = projectId;
    this.private = privateScan;
    this.initializerUserId = initializerUserId;
    this.createAt = createAt;
    this.updatedAt = updatedAt;
    this.scanType = scanType;
    this.startTime = startTime;
    this.endTime = endTime;
    this.containers = containers;
    this.progress = progress;
    this.step = step;
    this.vulnerabilityDetected = vulnerabilityDetected;
    this.errorMessage = errorMessage;
    this.errorCode = errorCode;
    this.errorCategory = errorCategory;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
