import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AsyncTaskDto {
  @ApiProperty({ description: 'Unique task identifier' })
  taskId: string;

  @ApiProperty({ description: 'Task type, e.g. vuln_batch_update' })
  type: string;

  @ApiProperty({
    description: 'Task lifecycle status',
    enum: ['queued', 'running', 'completed', 'failed'],
  })
  status: string;

  @ApiProperty({ description: 'Total number of items to process' })
  total: number;

  @ApiProperty({ description: 'Number of items processed so far' })
  processed: number;

  @ApiProperty({ description: 'Number of items successfully processed' })
  succeeded: number;

  @ApiProperty({ description: 'Number of items that failed' })
  failed: number;

  @ApiPropertyOptional({ description: 'Project scoped to this task' })
  projectId: string;

  @ApiPropertyOptional({ description: 'Organization scoped to this task' })
  organizationId: string;

  @ApiProperty({ description: 'User who owns this task' })
  userId: string;

  @ApiProperty({ description: 'Task creation timestamp (ms epoch)' })
  createdAt: number;

  @ApiProperty({ description: 'Task last-updated timestamp (ms epoch)' })
  updatedAt: number;

  @ApiPropertyOptional({ description: 'Error message if the task failed' })
  error: string;

  @ApiPropertyOptional({
    description: 'PR/MR URL set by autofix tasks on completion',
  })
  resultUrl?: string;
}
