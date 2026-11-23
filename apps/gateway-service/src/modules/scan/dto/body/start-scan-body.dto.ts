import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Validate } from 'class-validator';
import { PRODUCT_KEYS } from 'src/core/products/products';
import {
  BRANCH_NAME_MAX_LENGTH,
  IsGitBranchName,
} from './branch-name.validator';

/**
 * Valid scan source types indicating how the scan was initiated
 */
export const SCAN_SOURCE_TYPES = [
  'manual',
  'cli',
  'github',
  'gitlab',
  'jetbrains',
  'vscode',
] as const;
export type ScanSourceType = (typeof SCAN_SOURCE_TYPES)[number];

/**
 * DTO for starting a scan with optional branch and source type information
 */
export class StartScanBodyDto {
  @ApiPropertyOptional({
    description:
      'Branch name being scanned (for GitHub/GitLab integrations). If not provided, scan is not associated with a specific branch.',
    example: 'main',
    maxLength: BRANCH_NAME_MAX_LENGTH,
  })
  @IsString()
  @Validate(IsGitBranchName)
  @IsOptional()
  branch?: string;

  @ApiPropertyOptional({
    description:
      'Source type of the scan (manual, cli, github, gitlab, jetbrains, vscode). Defaults to manual if not provided.',
    example: 'manual',
    enum: SCAN_SOURCE_TYPES,
    default: 'manual',
  })
  @IsIn(SCAN_SOURCE_TYPES)
  @IsOptional()
  sourceType?: ScanSourceType;

  @ApiPropertyOptional({
    description:
      'The space the analysis is started from; one of the products this instance serves. Absent: the full scan.',
    enum: PRODUCT_KEYS,
  })
  @IsOptional()
  @IsIn(PRODUCT_KEYS)
  product?: string;
}
