import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Single vulnerability update item for batch operations.
 * At least one of status, priority, or comment must be provided.
 */
export class BatchUpdateVulnerabilityItemDto {
  @ApiProperty({
    description: 'Vulnerability unique identifier',
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000001',
  })
  @IsUUID()
  @IsNotEmpty()
  vulnerabilityId: string;

  @ApiPropertyOptional({
    description: 'New status of the vulnerability',
    enum: ['to_verify', 'resolved', 'confirmed', 'ignored'],
    example: 'ignored',
  })
  @IsString()
  @IsOptional()
  @IsIn(['to_verify', 'resolved', 'confirmed', 'ignored'])
  status?: string;

  @ApiPropertyOptional({
    description: 'New priority level',
    enum: ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'],
    example: 'urgent',
  })
  @IsString()
  @IsOptional()
  @IsIn(['critical_urgent', 'urgent', 'normal', 'low', 'very_low'])
  priority?: string;

  @ApiPropertyOptional({
    description: 'Comment about the vulnerability (max 512 chars)',
    maxLength: 512,
    example: 'Marked as not exploitable after security review',
  })
  @IsString()
  @IsOptional()
  @MaxLength(512, { message: 'Comment can be at most 512 characters long' })
  comment?: string;

  // Mandatory when THIS item sets `status = "ignored"`.
  // Per-item rather than per-request: a batch legitimately mixes a dismissal
  // with a resolve, and one shared reason would attribute a justification to
  // findings nobody wrote it for. Carried through the async job so a bulk
  // dismissal still satisfies `assertDismissalReason` in analysis-reporting.
  @ApiPropertyOptional({
    description:
      'Auditable justification for dismissing the finding. REQUIRED when this item sets status to "ignored". Surfaced as `dismissal_reason` by the GRC findings export.',
    maxLength: 512,
    example: 'Accepted risk — signed off by the CISO on 2026-07-01',
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
}

/**
 * Request body for batch updating multiple vulnerabilities at once.
 * Allows updating status, priority, and/or comment for up to 100 vulnerabilities in a single request.
 */
export class BatchUpdateVulnerabilitiesBodyDto {
  @ApiProperty({
    description:
      'List of vulnerabilities to update. Each item must contain vulnerabilityId and at least one field to update (status, priority, or comment).',
    type: [BatchUpdateVulnerabilityItemDto],
    minItems: 1,
    maxItems: 100,
    example: [
      {
        vulnerabilityId: '00000000-0000-4000-8000-000000000001',
        status: 'ignored',
        comment: 'Reviewed and marked as ignored',
        dismissalReason: 'Accepted risk — signed off by the CISO on 2026-07-01',
      },
      {
        vulnerabilityId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        status: 'resolved',
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one vulnerability must be provided' })
  @ArrayMaxSize(100, {
    message: 'Cannot update more than 100 vulnerabilities at once',
  })
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateVulnerabilityItemDto)
  items: BatchUpdateVulnerabilityItemDto[];

  // Chat agent audit trail. Filled by the MCP
  // ``batch_update_vulnerabilities`` tool after an HITL confirm so every
  // HistoryItem produced by the batch points to the same chat tool call.
  @ApiPropertyOptional({ description: 'Chat agent tool call id (HITL audit).' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  agentToolCallId?: string;

  @ApiPropertyOptional({
    description: 'Chat agent conversation id (HITL audit).',
  })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  agentConversationId?: string;

  @ApiPropertyOptional({ description: 'Chat agent stream id (HITL audit).' })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  agentStreamId?: string;
}
