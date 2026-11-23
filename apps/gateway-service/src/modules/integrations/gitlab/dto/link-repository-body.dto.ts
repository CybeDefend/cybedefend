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
 * DTO for linking GitLab repository to project
 */
export class LinkGitlabRepositoryDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'GitLab repository identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  repositoryId: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Branch to scan (defaults to repository default branch if not specified)',
    example: 'main',
  })
  scanBranch?: string;

  @ApiPropertyOptional({
    description:
      'The space the link is made from; one of the products this instance serves. Absent: the full scan.',
    enum: PRODUCT_KEYS,
  })
  @IsOptional()
  @IsIn(PRODUCT_KEYS)
  product?: string;
}
