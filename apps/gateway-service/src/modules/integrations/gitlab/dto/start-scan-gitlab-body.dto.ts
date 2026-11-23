import {
  IsIn,
  IsUUID,
  IsNotEmpty,
  IsString,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRODUCT_KEYS } from 'src/core/products/products';

/**
 * DTO for starting GitLab scan
 */
export class StartScanGitlabBodyDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'GitLab repository identifier to scan',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  repositoryId: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Branch to scan (defaults to configured scan branch or repository default branch)',
    example: 'main',
  })
  branch?: string;

  @ApiPropertyOptional({
    description:
      'The space the scan is started from; one of the products this instance serves. Absent: the full scan.',
    enum: PRODUCT_KEYS,
  })
  @IsOptional()
  @IsIn(PRODUCT_KEYS)
  product?: string;
}
