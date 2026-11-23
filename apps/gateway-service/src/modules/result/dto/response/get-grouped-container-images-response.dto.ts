import { ApiProperty } from '@nestjs/swagger';

class VulnCountsDto {
  @ApiProperty({ description: 'Number of critical vulnerabilities' })
  critical: number;

  @ApiProperty({ description: 'Number of high severity vulnerabilities' })
  high: number;

  @ApiProperty({ description: 'Number of medium severity vulnerabilities' })
  medium: number;

  @ApiProperty({ description: 'Number of low severity vulnerabilities' })
  low: number;

  @ApiProperty({ description: 'Number of unknown severity vulnerabilities' })
  unknown: number;
}

class ContainerImageTagDto {
  @ApiProperty({ description: 'Original image entity ID' })
  id: string;

  @ApiProperty({
    description:
      'Tag extracted from artifact name. Empty when the image was scanned by ' +
      'digest only — such an artifact carries no tag, and reporting "latest" ' +
      'would both mislabel it and make two digests of the same repository ' +
      'indistinguishable.',
    example: 'v1.0.0',
  })
  tag: string;

  @ApiProperty({
    description:
      'Full digest extracted from the artifact name, empty when the image was ' +
      'addressed by tag. Rebuild the reference as `repositoryName@digest` — a ' +
      'digest is only addressable with "@", never with ":".',
    example:
      'sha256:1f4d0d0d5a1e4b6c8f9a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70',
  })
  digest: string;

  @ApiProperty({
    description:
      'True when this tag runs an end-of-support-life base OS (no advisories ' +
      'published any more — vulnerability detection is incomplete).',
  })
  osEosl: boolean;

  @ApiProperty({ description: 'Scan ID associated with this tag' })
  scanId: string;

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  createdAt: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updatedAt: string;

  @ApiProperty({
    type: VulnCountsDto,
    description: 'Vulnerability counts for this specific tag',
  })
  vulnCounts: VulnCountsDto;
}

class GroupedContainerImageDto {
  @ApiProperty({
    description: 'Repository name without tag',
    example: 'registry.gitlab.com/group/project',
  })
  repositoryName: string;

  @ApiProperty({ description: 'Project identifier' })
  projectId: string;

  @ApiProperty({ description: 'Operating system family', example: 'debian' })
  osFamily: string;

  @ApiProperty({
    description: 'Operating system name',
    example: 'Debian GNU/Linux 11',
  })
  osName: string;

  @ApiProperty({
    description:
      'True when ANY tag of the repository runs an end-of-support-life base OS.',
  })
  osEosl: boolean;

  @ApiProperty({ description: 'Branch that was scanned', example: 'main' })
  branch: string;

  @ApiProperty({
    description: 'Number of different tags for this repository',
    example: 3,
  })
  tagCount: number;

  @ApiProperty({
    type: [ContainerImageTagDto],
    description: 'All tags for this repository',
  })
  tags: ContainerImageTagDto[];

  @ApiProperty({
    type: VulnCountsDto,
    description: 'Aggregated vulnerability counts across all tags',
  })
  aggregatedVulnCounts: VulnCountsDto;

  @ApiProperty({
    description: 'Most recent scan date across all tags (ISO 8601)',
    example: '2024-01-15T10:30:00.000Z',
  })
  latestScanAt: string;
}

export class GetGroupedContainerImagesResponseDto {
  @ApiProperty({ description: 'Project name' })
  projectName: string;

  @ApiProperty({
    type: [GroupedContainerImageDto],
    description: 'Container images grouped by repository',
  })
  groupedImages: GroupedContainerImageDto[];

  @ApiProperty({ description: 'Total number of unique repositories' })
  totalRepositories: number;

  @ApiProperty({ description: 'Total number of tags across all repositories' })
  totalTags: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Current page number' })
  currentPage: number;

  @ApiProperty({ description: 'Number of items per page' })
  pageSize: number;
}
