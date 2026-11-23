// src/global-management/vulnerability/body/update-result-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  IsUUID,
  ValidateIf,
} from 'class-validator';

const EXPLOITABILITY_VERDICTS = [
  'proven',
  'actively_exploited',
  'theoretical',
  'not_exploitable',
] as const;

export type ExploitabilityVerdict = (typeof EXPLOITABILITY_VERDICTS)[number];

/**
 * Verdict values ACCEPTED as input: the 4 verdicts + the reset sentinel
 * `not_evaluated` (sets the verdict back to NULL in analysis-reporting).
 */
const EXPLOITABILITY_VERDICT_INPUTS = [
  ...EXPLOITABILITY_VERDICTS,
  'not_evaluated',
] as const;

export class UpdateResultBodyDto {
  @ApiProperty({
    description: 'Status of the vulnerability',
    required: false,
    enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['to_verify', 'resolved', 'confirmed', 'ignored'])
  status: string;

  @ApiProperty({
    description: 'Priority level',
    required: false,
    enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'])
  priority: string;

  @ApiProperty({
    description: 'Comment about the vulnerability (max 512 chars)',
    required: false,
    maxLength: 512,
  })
  @IsString()
  @IsOptional()
  @MaxLength(512, { message: 'Comment can be at most 512 characters long' })
  comment: string;

  // An `ignored` finding with no stated reason is the one
  // thing a GRC platform cannot paper over, so the justification is MANDATORY on
  // that transition. Deliberately a breaking change on this endpoint.
  //
  // NOT a reuse of `comment`: a comment is free-form and may accompany any
  // status, while this is the auditable justification for ONE transition, and
  // the export surfaces it as its own `dismissal_reason` column.
  //
  // This DTO is only the clean 400. The CONTROL is `assertDismissalReason` in
  // analysis-reporting — the batch path and every other gRPC caller bypass this
  // class, and a check that only exists at the edge is not a control.
  //
  // `@ValidateIf` gates the WHOLE property (class-validator ANDs every
  // conditional on a property and applies it to all of that property's
  // constraints), so the 512 cap is enforced exactly where the value is
  // persisted; on any other status analysis-reporting stores NULL regardless.
  @ApiProperty({
    description:
      'Auditable justification for dismissing the finding. REQUIRED when status is "ignored". Surfaced as `dismissal_reason` by the GRC findings export.',
    required: false,
    maxLength: 512,
    example:
      'Not reachable from any entry point — compensating WAF rule in place',
  })
  @ValidateIf((o) => o.status === 'ignored')
  @IsString()
  @IsNotEmpty({
    message: 'dismissalReason is required when status is "ignored"',
  })
  @Matches(/\S/, { message: 'dismissalReason cannot be blank' })
  @MaxLength(512, {
    message: 'dismissalReason can be at most 512 characters long',
  })
  dismissalReason?: string;

  @ApiProperty({
    description: 'User unique identifier that updates the vulnerability',
    required: false,
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  userId: string;

  // Exploitability override (manual verdict from analyst).
  // When set, the gateway forces ``exploitabilitySource = 'manual'`` so the
  // analysis-reporting EPSS/OSV crons skip recalculation for 7 days.
  @ApiProperty({
    description:
      "Manual exploitability verdict. When provided, the source is forced to 'manual' server-side. Pass 'not_evaluated' to reset the verdict back to null.",
    required: false,
    enum: EXPLOITABILITY_VERDICT_INPUTS,
  })
  @IsString()
  @IsOptional()
  @IsIn(EXPLOITABILITY_VERDICT_INPUTS as unknown as string[])
  exploitabilityVerdict?: ExploitabilityVerdict | 'not_evaluated';

  @ApiProperty({
    description: 'Free-form rationale for the exploitability verdict.',
    required: false,
    maxLength: 1024,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  exploitabilityReason?: string;

  // Chat agent audit trail forwarded to HistoryItem.
  // Filled by the MCP set_exploitability / update_vulnerability tools after
  // an HITL confirm; not meant to be set by humans through the public API.
  @ApiProperty({
    description: 'Chat agent tool call id (HITL audit).',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  agentToolCallId?: string;

  @ApiProperty({
    description: 'Chat agent conversation id (HITL audit).',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  agentConversationId?: string;

  @ApiProperty({
    description: 'Chat agent stream id (HITL audit).',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  agentStreamId?: string;

  constructor(
    status: string,
    priority: string,
    comment: string,
    userId: string,
  ) {
    this.status = status;
    this.priority = priority;
    this.comment = comment;
    this.userId = userId;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
