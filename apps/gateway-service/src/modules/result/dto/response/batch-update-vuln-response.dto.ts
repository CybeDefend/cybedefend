import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Result of a single vulnerability update in batch operation.
 */
export class BatchUpdateResultItemDto {
  @ApiProperty({
    description: 'Vulnerability unique identifier',
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000001',
  })
  vulnerabilityId: string;

  @ApiProperty({
    description: 'Whether the update was successful',
    example: true,
  })
  success: boolean;

  @ApiPropertyOptional({
    description: 'Error message if the update failed',
    example: 'Vulnerability not found',
  })
  error?: string;
}

/**
 * Response for batch update vulnerabilities operation.
 */
export class BatchUpdateVulnerabilitiesResponseDto {
  @ApiProperty({
    description: 'Project unique identifier',
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000002',
  })
  projectId: string;

  @ApiProperty({
    description: 'Total number of vulnerabilities processed',
    example: 5,
  })
  totalCount: number;

  @ApiProperty({
    description: 'Number of successful updates',
    example: 4,
  })
  successCount: number;

  @ApiProperty({
    description: 'Number of failed updates',
    example: 1,
  })
  failureCount: number;

  @ApiProperty({
    description: 'Detailed results per vulnerability',
    type: [BatchUpdateResultItemDto],
    example: [
      {
        vulnerabilityId: '00000000-0000-4000-8000-000000000001',
        success: true,
      },
      {
        vulnerabilityId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        success: false,
        error: 'Vulnerability not found',
      },
    ],
  })
  results: BatchUpdateResultItemDto[];
}
