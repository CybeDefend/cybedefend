import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VulnerabilityInfoDto } from '../../../jira/dto/body/create-jira-issues-body.dto';

export class CreateLinearIssuesBodyDto {
  @ApiPropertyOptional({
    description: 'Scan ID (optional — used for deduplication)',
  })
  @IsString()
  @IsOptional()
  scanId?: string;

  @ApiProperty({
    description:
      'Issue creation mode: 1=per_vulnerability, 2=per_vulnerability_type, 3=per_file',
    example: 2,
  })
  @IsNumber()
  mode: number;

  @ApiProperty({
    description: 'Vulnerabilities to create issues for',
    type: [VulnerabilityInfoDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VulnerabilityInfoDto)
  vulnerabilities: VulnerabilityInfoDto[];

  @ApiProperty({ description: 'Base URL for CybeDefend links' })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Matches(
    /^https:\/\/(?!localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/,
    { message: 'cybedefendBaseUrl must be a public HTTPS URL' },
  )
  @MaxLength(2048)
  cybedefendBaseUrl: string;

  @ApiPropertyOptional({
    description:
      "Override the Linear team ID (uses the project's configured team if not specified)",
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Linear project ID to attach the tickets to',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  linearProjectId?: string;

  @ApiPropertyOptional({
    description: 'Linear user ID to assign the tickets to',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'Linear label IDs added to the tickets (20 at most)',
    type: [String],
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  labelIds?: string[];

  @ApiPropertyOptional({
    description:
      'Linear priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. Derived from the severity when absent.',
    minimum: 0,
    maximum: 4,
  })
  @IsInt()
  @Min(0)
  @Max(4)
  @IsOptional()
  priority?: number;
}
