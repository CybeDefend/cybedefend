import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Body DTO for the batch project-branches endpoint.
 *
 * `projectIds` now travels in the JSON request body (the endpoint moved from
 * GET + comma-separated query string to POST) so large organizations don't
 * push a 100×UUID list into the URL. The upper bound (100) matches the largest
 * realistic org size; the lower bound (1) rejects empty calls that would
 * otherwise just return [].
 */
export class GetBatchProjectsBranchesBodyDto {
  @ApiProperty({
    description: 'Project UUIDs to fetch branches for',
    type: [String],
    example: [
      '550e8400-e29b-41d4-a716-446655440000',
      '00000000-0000-4000-8000-000000000003',
    ],
    maxItems: 100,
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  projectIds: string[];
}
