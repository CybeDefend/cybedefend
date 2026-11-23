import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsArray } from 'class-validator';
import { SCAN_SOURCE_TYPES, ScanSourceType } from './start-scan-body.dto';

export class StartContainerScanBodyDto {
  @ApiProperty({
    description:
      'The public Docker image to scan (e.g., "alpine:latest", "node:18-alpine")',
    example: 'node:18-alpine',
  })
  @IsString()
  imageToScan: string;

  @ApiPropertyOptional({
    description:
      'Git branch the image was built from. On a project linked to GitHub or GitLab it must be a branch of that repository, ' +
      'otherwise the scan is refused (400): an image tag belongs in imageToScan. ' +
      "Defaults to the project's reference branch, else the repository's default branch, else main.",
    example: 'main',
  })
  @IsOptional()
  @IsString()
  branch?: string;

  @ApiPropertyOptional({
    description: 'Types of vulnerabilities to look for.',
    example: ['CRITICAL', 'HIGH'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vulnerabilityTypes?: string[];

  @ApiPropertyOptional({
    description:
      'Source type of the scan (manual, cli, github, gitlab). Defaults to manual if not provided.',
    example: 'manual',
    enum: SCAN_SOURCE_TYPES,
    default: 'manual',
  })
  @IsIn(SCAN_SOURCE_TYPES)
  @IsOptional()
  sourceType?: ScanSourceType;
}
