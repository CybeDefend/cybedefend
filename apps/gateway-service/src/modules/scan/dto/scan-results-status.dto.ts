import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const SCAN_RESULTS_STATUSES = [
  'pending',
  'processing',
  'ready',
] as const;

export class ScanResultsStatusDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The unique identifier of the scan',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  scanId: string;

  @ApiProperty({
    description: 'The state of the scan',
    example: 'completed',
  })
  state: string;

  @ApiProperty({
    enum: SCAN_RESULTS_STATUSES,
    description:
      "Whether the scan's results are final. pending: the results are not being processed yet. processing: the results are still being processed and may change. ready: the scan has ended and its results will not change; a completed_degraded scan may hold partial results (see its error fields). Set by current versions of the API.",
    example: 'ready',
  })
  resultsStatus: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'ISO-8601 time at which the results became final. Absent until then.',
    example: '2026-11-13T10:15:30.000Z',
  })
  resultsFinalizedAt?: string;
}
