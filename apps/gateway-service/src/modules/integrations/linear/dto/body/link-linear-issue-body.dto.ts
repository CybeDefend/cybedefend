import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
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
import { VulnerabilityInfoDto } from '../../../jira/dto/body/create-jira-issues-body.dto';

export class LinkLinearIssueBodyDto {
  @ApiProperty({
    description:
      'Linear issue to link to: an identifier (e.g. "ENG-142") or a https://linear.app/ issue URL',
    example: 'ENG-142',
  })
  @IsString()
  @IsNotEmpty()
  // Any case: external-integrations upper-cases an identifier.
  @Matches(
    /^([A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}|https:\/\/linear\.app\/\S{1,400})$/,
  )
  issueRef: string;

  @ApiProperty({
    description: 'CybeDefend vulnerability IDs to link (500 at most)',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  vulnerabilityIds: string[];

  @ApiProperty({
    description: 'Scanner type for the vulnerabilities',
    example: 'sast',
  })
  @IsString()
  @IsNotEmpty()
  scannerType: string;

  @ApiPropertyOptional({
    description: 'Vulnerability details for enriching the Linear ticket',
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
