import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsArray, IsUUID } from 'class-validator';

/**
 * Response DTO for project branches retrieved from vulnerability detections.
 * Used for projects not linked to external integrations (GitHub/GitLab).
 */
export class GetProjectBranchesResponseDto {
  @ApiProperty({
    description: 'Project identifier',
    type: 'string',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description:
      'List of distinct branch names found in SAST, SCA, and IAC vulnerability detections',
    type: [String],
    example: ['main', 'develop', 'feature/new-feature'],
  })
  @IsArray()
  @IsString({ each: true })
  branches: string[];
}
