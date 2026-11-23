import { ApiProperty } from '@nestjs/swagger';

/**
 * A single branch in the unified paginated branch list.
 *
 * `isProtected` is always populated for git-backed providers (GitHub/GitLab)
 * and `false` for native (scan-derived) branches, which have no protection
 * concept.
 */
export class BranchListItemDto {
  @ApiProperty({ description: 'Branch name', example: 'main' })
  name: string;

  @ApiProperty({
    description: "Whether this is the provider's default branch",
    example: true,
  })
  isDefault: boolean;

  @ApiProperty({
    description: 'Whether the branch is protected (git providers only)',
    example: false,
  })
  isProtected: boolean;

  @ApiProperty({
    description: 'Whether the branch has been archived in CybeDefend',
    example: false,
  })
  archived: boolean;
}

export class BranchListPaginationDto {
  @ApiProperty({ description: 'Current page (1-based)', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', example: 30 })
  pageSize: number;

  @ApiProperty({
    description: 'Total number of branches matching the query',
    example: 42,
  })
  total: number;

  @ApiProperty({
    description: 'Whether more pages are available after the current one',
    example: true,
  })
  hasMore: boolean;
}

export class GetBranchesListResponseDto {
  @ApiProperty({ type: [BranchListItemDto] })
  branches: BranchListItemDto[];

  @ApiProperty({ type: BranchListPaginationDto })
  pagination: BranchListPaginationDto;

  @ApiProperty({
    description: "The provider's default branch name",
    example: 'main',
  })
  defaultBranch: string;

  @ApiProperty({
    description:
      'The branch currently configured for scanning (git providers only)',
    example: 'main',
  })
  scanBranch: string;
}
