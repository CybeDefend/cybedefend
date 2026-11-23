import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ViolationDto } from './violation-response.dto';

export class BlockingReasonDto {
  @ApiProperty({ description: 'Rule ID' })
  ruleId: string;

  @ApiProperty({ description: 'Rule name' })
  ruleName: string;

  @ApiProperty({ description: 'Blocking message' })
  message: string;

  @ApiProperty({ description: 'Severity' })
  severity: string;
}

export class EvaluateScanResponseDto {
  @ApiProperty({
    description: 'Scan ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  scanId: string;

  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  projectId: string;

  @ApiProperty({
    description: 'Whether the scan passed all policies',
    example: false,
  })
  passed: boolean;

  @ApiProperty({
    description: 'Number of blocking violations',
    example: 2,
  })
  blockingViolationsCount: number;

  @ApiProperty({
    description: 'Number of warning violations',
    example: 5,
  })
  warningViolationsCount: number;

  @ApiProperty({
    description: 'Number of notification-only violations',
    example: 10,
  })
  notifyViolationsCount: number;

  @ApiProperty({
    description: 'Blocking reasons (if scan failed)',
    type: [BlockingReasonDto],
  })
  blockingReasons: BlockingReasonDto[];

  @ApiProperty({
    description: 'All violations recorded',
    type: [ViolationDto],
  })
  violations: ViolationDto[];

  @ApiProperty({
    description: 'Evaluation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  evaluatedAt: string;
}

export class CheckComplianceResponseDto {
  @ApiProperty({
    description: 'Whether the scan is compliant',
    example: true,
  })
  compliant: boolean;

  @ApiProperty({
    description: 'CI/CD exit code (0 = pass, 1 = fail)',
    example: 0,
  })
  exitCode: number;

  @ApiProperty({
    description: 'Human-readable summary',
    example: 'All policies passed. 3 warnings found.',
  })
  summary: string;

  @ApiProperty({
    description: 'Blocking reasons (if not compliant)',
    type: [BlockingReasonDto],
  })
  blockingReasons: BlockingReasonDto[];

  @ApiProperty({
    description: 'Number of blocking violations',
    example: 0,
  })
  blockingCount: number;

  @ApiProperty({
    description: 'Number of warning violations',
    example: 3,
  })
  warningCount: number;

  @ApiProperty({
    description: 'Number of notification violations',
    example: 5,
  })
  notifyCount: number;
}

export class DryRunEvaluationResponseDto {
  @ApiProperty({
    description: 'Number of violations that would occur',
    example: 5,
  })
  violationCount: number;

  @ApiProperty({
    description: 'Number of blocking violations',
    example: 2,
  })
  blockingCount: number;

  @ApiProperty({
    description: 'Number of warning violations',
    example: 3,
  })
  warningCount: number;

  @ApiProperty({
    description: 'Potential violations (not recorded)',
    type: [ViolationDto],
  })
  potentialViolations: ViolationDto[];

  @ApiProperty({
    description: 'Would the scan be blocked',
    example: true,
  })
  wouldBlock: boolean;
}

/**
 * Evaluation status enum
 */
export enum EvaluationStatusEnum {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  NOT_STARTED = 'NOT_STARTED',
}

/**
 * Response for triggering async evaluation
 */
export class TriggerEvaluationResponseDto {
  @ApiProperty({
    description: 'Unique evaluation ID for tracking',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  evaluationId: string;

  @ApiProperty({
    description: 'Status message',
    example: 'Policy evaluation queued successfully',
  })
  message: string;

  @ApiProperty({
    description: 'When the evaluation was queued',
    example: '2024-01-15T10:30:00Z',
  })
  queuedAt: string;
}

/**
 * Response for getting evaluation status
 */
export class EvaluationStatusResponseDto {
  @ApiProperty({
    description: 'Evaluation ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  evaluationId: string;

  @ApiProperty({
    description: 'Current status of the evaluation',
    enum: EvaluationStatusEnum,
    example: EvaluationStatusEnum.COMPLETED,
  })
  status: EvaluationStatusEnum;

  @ApiProperty({
    description: 'Progress percentage (0-100)',
    example: 75,
  })
  progress: number;

  @ApiProperty({
    description: 'Status message or error details',
    example: 'Evaluating 3 policies...',
  })
  message: string;

  @ApiProperty({
    description: 'When the evaluation started',
    example: '2024-01-15T10:30:00Z',
  })
  startedAt: string;

  @ApiProperty({
    description: 'When the evaluation completed (if done)',
    example: '2024-01-15T10:31:00Z',
    required: false,
  })
  completedAt?: string;
}

/**
 * Response for getting evaluation status by scan ID (for CLI)
 */
export class ScanEvaluationStatusResponseDto {
  @ApiProperty({
    description: 'Whether an evaluation exists for this scan',
    example: true,
  })
  hasEvaluation: boolean;

  @ApiProperty({
    description: 'Evaluation ID (if exists)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  evaluationId?: string;

  @ApiProperty({
    description: 'Current status of the evaluation',
    enum: EvaluationStatusEnum,
    example: EvaluationStatusEnum.COMPLETED,
  })
  status: EvaluationStatusEnum;

  @ApiProperty({
    description: 'Progress percentage (0-100)',
    example: 75,
  })
  progress: number;

  @ApiProperty({
    description: 'Status message or error details',
    example: 'Evaluating 3 policies...',
  })
  message: string;

  @ApiProperty({
    description: 'When the evaluation started',
    example: '2024-01-15T10:30:00Z',
    required: false,
  })
  startedAt?: string;

  @ApiProperty({
    description: 'When the evaluation completed (if done)',
    example: '2024-01-15T10:31:00Z',
    required: false,
  })
  completedAt?: string;
}

/**
 * Compliance result embedded in the response
 */
export class ComplianceResultDto {
  @ApiProperty({
    description: 'Whether the scan is compliant with all policies',
    example: false,
  })
  compliant: boolean;

  @ApiPropertyOptional({
    description: 'Exit code for CI/CD (0=pass, 1=fail)',
    example: 1,
  })
  exitCode?: number;

  @ApiPropertyOptional({
    description: 'Human-readable summary',
    example: 'Policy check failed: 2 critical violations found.',
  })
  summary?: string;

  @ApiProperty({
    description: 'Number of blocking violations',
    example: 2,
  })
  blockingViolationsCount: number;

  @ApiProperty({
    description: 'Number of warning violations',
    example: 5,
  })
  warningViolationsCount: number;

  @ApiProperty({
    description: 'Total violations count',
    example: 7,
  })
  totalViolationsCount: number;

  @ApiProperty({
    description: 'When the evaluation was completed',
    example: '2024-01-15T10:31:00Z',
  })
  evaluatedAt: string;

  @ApiPropertyOptional({
    description: 'Number of policies that were evaluated',
    example: 3,
  })
  evaluatedPoliciesCount?: number;

  @ApiProperty({
    description: 'Number of unique rules broken',
    example: 2,
  })
  breakingRulesCount: number;
}

/**
 * Response for getting compliance result
 */
export class ComplianceResultResponseDto {
  @ApiPropertyOptional({
    description: 'Evaluation ID (may not be available)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  evaluationId?: string;

  @ApiProperty({
    description: 'Scan ID that was evaluated',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  scanId: string;

  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  projectId: string;

  @ApiProperty({
    description: 'Evaluation status',
    enum: EvaluationStatusEnum,
    example: EvaluationStatusEnum.COMPLETED,
  })
  status: EvaluationStatusEnum;

  @ApiPropertyOptional({
    description: 'Compliance result (only present when completed)',
    type: ComplianceResultDto,
  })
  result?: ComplianceResultDto;

  @ApiPropertyOptional({
    description: 'Violations found during evaluation',
    type: [ViolationDto],
  })
  violations?: ViolationDto[];

  @ApiPropertyOptional({
    description: 'Error message if evaluation failed',
  })
  error?: string;
}

/**
 * Single entry in compliance history
 */
export class ComplianceHistoryEntryDto {
  @ApiPropertyOptional({
    description: 'Evaluation ID (may not be available for all entries)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  evaluationId?: string;

  @ApiProperty({
    description: 'Scan ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  scanId: string;

  @ApiProperty({
    description: 'Whether the scan was compliant',
    example: true,
  })
  compliant: boolean;

  @ApiProperty({
    description: 'Number of blocking violations',
    example: 0,
  })
  blockingViolationsCount: number;

  @ApiProperty({
    description: 'Number of warning violations',
    example: 3,
  })
  warningViolationsCount: number;

  @ApiProperty({
    description: 'When the evaluation was completed',
    example: '2024-01-15T10:31:00Z',
  })
  evaluatedAt: string;

  @ApiProperty({
    description: 'Number of unique rules broken',
    example: 2,
  })
  breakingRulesCount: number;
}

/**
 * Response for compliance history
 */
export class ComplianceHistoryResponseDto {
  @ApiProperty({
    description: 'Compliance history entries',
    type: [ComplianceHistoryEntryDto],
  })
  entries: ComplianceHistoryEntryDto[];

  @ApiProperty({
    description: 'Total number of entries',
    example: 25,
  })
  total: number;

  @ApiProperty({
    description: 'Current page',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Page size',
    example: 10,
  })
  pageSize: number;
}

/**
 * Response for exporting policy as YAML
 */
export class ExportPolicyYamlResponseDto {
  @ApiProperty({
    description: 'YAML content of the policy',
    example: `# Security Policy: Production SAST Rules
version: "1.0"
rules:
  - id: block-critical
    type: severity
    operator: equals
    value: critical
    action: block`,
  })
  yamlContent: string;
}
