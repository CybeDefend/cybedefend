// src/github-service/body/link-repository-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PRODUCT_KEYS } from 'src/core/products/products';
export class LinkRepositoryBodyDto {
  @ApiProperty({ description: 'Repository identifier', example: 'uuid-value' })
  @IsUUID()
  @IsNotEmpty()
  repositoryId: string;

  @ApiPropertyOptional({
    description:
      'Branch to scan (defaults to repository default branch if not specified)',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  scanBranch?: string;

  @ApiPropertyOptional({
    description:
      'The space the link is made from; one of the products this instance serves. Absent: the full scan.',
    enum: PRODUCT_KEYS,
  })
  @IsOptional()
  @IsIn(PRODUCT_KEYS)
  product?: string;

  constructor(repositoryId: string, scanBranch?: string) {
    this.repositoryId = repositoryId;
    this.scanBranch = scanBranch;
  }

  public toString(): string {
    return JSON.stringify({
      repositoryId: this.repositoryId,
      scanBranch: this.scanBranch,
    });
  }
}
