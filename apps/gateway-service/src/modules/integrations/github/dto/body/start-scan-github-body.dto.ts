// src/github-service/body/start-scan-github-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsUUID,
  IsNotEmpty,
  IsString,
  IsOptional,
} from 'class-validator';
import { PRODUCT_KEYS } from 'src/core/products/products';
export class StartScanGithubBodyDto {
  @ApiProperty({ description: 'Repository identifier', example: 'uuid-value' })
  @IsUUID()
  @IsNotEmpty()
  repositoryId: string;

  @ApiPropertyOptional({
    description:
      'Branch to scan (defaults to configured scan branch or repository default branch)',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  branch?: string;

  @ApiPropertyOptional({
    description:
      'The space the scan is started from; one of the products this instance serves. Absent: the full scan.',
    enum: PRODUCT_KEYS,
  })
  @IsOptional()
  @IsIn(PRODUCT_KEYS)
  product?: string;

  constructor(repositoryId: string, branch?: string) {
    this.repositoryId = repositoryId;
    this.branch = branch;
  }

  public toString(): string {
    return JSON.stringify({
      repositoryId: this.repositoryId,
      branch: this.branch,
    });
  }
}
