import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for the async batch-update endpoint (HTTP 202).
 * The caller should poll or subscribe via SSE to track task progress.
 */
export class EnqueueBatchUpdateResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the async task',
    example: '8f14e45f-ceea-467a-a866-4b0f33b7e0a1',
  })
  taskId: string;

  @ApiProperty({
    description: 'Initial status of the task',
    enum: ['queued'],
    example: 'queued',
  })
  status: 'queued';

  @ApiProperty({
    description: 'Total number of vulnerabilities to be updated',
    example: 10,
  })
  total: number;
}
