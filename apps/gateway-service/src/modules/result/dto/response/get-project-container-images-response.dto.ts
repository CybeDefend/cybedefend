import { ApiProperty } from '@nestjs/swagger';

class VulnCountsDto {
  @ApiProperty()
  critical: number;
  @ApiProperty()
  high: number;
  @ApiProperty()
  medium: number;
  @ApiProperty()
  low: number;
  @ApiProperty()
  unknown: number;
}

class ContainerImageDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  projectId: string;
  @ApiProperty()
  artifactName: string;
  @ApiProperty()
  osFamily: string;
  @ApiProperty()
  osName: string;
  @ApiProperty({
    description:
      'True when the base OS is end-of-support-life: the distribution no ' +
      'longer publishes advisories, so a zero-vulnerability result means ' +
      '"detection impossible", not "clean".',
  })
  osEosl: boolean;
  @ApiProperty()
  createdAt: string;
  @ApiProperty()
  updatedAt: string;
  @ApiProperty({ type: VulnCountsDto })
  vulnCounts: VulnCountsDto;
}

export class GetProjectContainerImagesResponseDto {
  @ApiProperty()
  projectName: string;
  @ApiProperty({ type: [ContainerImageDto] })
  images: ContainerImageDto[];
  @ApiProperty({ description: 'Total number of images in the project' })
  totalImages: number;
  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
  @ApiProperty({ description: 'Current page number' })
  currentPage: number;
  @ApiProperty({ description: 'Number of items per page' })
  pageSize: number;
}
