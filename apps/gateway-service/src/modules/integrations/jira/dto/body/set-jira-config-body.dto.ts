import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class SetJiraConfigBodyDto {
  @ApiProperty({
    description: 'Jira project ID',
    example: '10001',
  })
  @IsString()
  @IsNotEmpty()
  jiraProjectId: string;

  @ApiProperty({
    description: 'Jira project key',
    example: 'TRI',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z][A-Z0-9_]+$/)
  jiraProjectKey: string;

  @ApiProperty({
    description: 'Jira project name',
    example: 'Triage',
  })
  @IsString()
  @IsNotEmpty()
  jiraProjectName: string;

  @ApiPropertyOptional({
    description:
      'Allowed branches for Jira ticket creation. Empty array = all branches allowed.',
    example: ['develop', 'main'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(50)
  @MaxLength(255, { each: true })
  allowedBranches?: string[];

  @ApiPropertyOptional({
    description: 'Whether to auto-create Jira tickets after scans',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  autoCreateEnabled?: boolean;
}
