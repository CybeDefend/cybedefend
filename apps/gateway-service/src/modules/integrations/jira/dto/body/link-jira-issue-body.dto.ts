import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VulnerabilityInfoDto } from './create-jira-issues-body.dto';

export class LinkJiraIssueBodyDto {
  @ApiProperty({
    description: 'Jira issue key to link to (e.g. "TRI-142")',
    example: 'TRI-142',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z][A-Z0-9_]+-\d+$/)
  jiraIssueKey: string;

  @ApiProperty({
    description: 'CybeDefend vulnerability IDs to link',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  vulnerabilityIds: string[];

  @ApiProperty({
    description: 'Scanner type for the vulnerabilities',
    example: 'sast',
  })
  @IsString()
  @IsNotEmpty()
  scannerType: string;

  @ApiPropertyOptional({
    description: 'Vulnerability details for enriching the Jira ticket',
    type: [VulnerabilityInfoDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VulnerabilityInfoDto)
  @IsOptional()
  vulnerabilities?: VulnerabilityInfoDto[];

  @ApiPropertyOptional({ description: 'Base URL for CybeDefend links' })
  @IsString()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @Matches(
    /^https:\/\/(?!localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/,
    { message: 'cybedefendBaseUrl must be a public HTTPS URL' },
  )
  @MaxLength(2048)
  cybedefendBaseUrl?: string;
}
