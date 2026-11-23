import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Per-project entry in the batch response.
 *
 * `branches` is intentionally permissive: a project where the gRPC call
 * failed shows up with `branches: []` rather than being omitted, so the
 * frontend can render an empty group without re-issuing the request.
 */
export class ProjectBranchesEntryDto {
  @ApiProperty({
    description: 'Project identifier',
    type: 'string',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  projectId: string;

  @ApiProperty({
    description: 'Distinct active branch names for the project',
    type: [String],
    example: ['main', 'develop'],
  })
  @IsArray()
  @IsString({ each: true })
  branches: string[];

  @ApiProperty({
    description:
      'Archived branch names for the project (hidden from default views)',
    type: [String],
    example: ['legacy-1.x'],
  })
  @IsArray()
  @IsString({ each: true })
  archivedBranches: string[];

  @ApiProperty({
    description:
      "The project's reference branch as configured in global-management. Empty when the project has none; the dashboard then falls back to main/master.",
    type: 'string',
    example: 'develop',
  })
  @IsString()
  defaultBranch: string;
}

export class GetBatchProjectsBranchesResponseDto {
  @ApiProperty({
    description: 'One entry per project_id in the request, in the same order',
    type: [ProjectBranchesEntryDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProjectBranchesEntryDto)
  projects: ProjectBranchesEntryDto[];
}
