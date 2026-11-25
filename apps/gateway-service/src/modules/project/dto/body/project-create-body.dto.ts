import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';

import {
  PROJECT_NAME_MAX_LENGTH,
  ProjectNameRules,
} from './project-name.rules';
import { ProjectSecurityContextUpdateDto } from './project-security-context-update.dto';
import { PRODUCT_KEYS } from 'src/core/products/products';

export class ProjectCreateBodyDto {
  @ApiProperty({
    description: 'Name of the project, trimmed, from 1 to 255 characters',
    example: 'My Project',
    maxLength: PROJECT_NAME_MAX_LENGTH,
  })
  @ProjectNameRules()
  readonly name: string;

  @ApiProperty({
    description: 'Enable GitHub issue creation for vulnerabilities',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly githubIssueEnabled?: boolean;

  @ApiProperty({
    description: 'Enable GitLab issue creation for vulnerabilities',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly gitlabIssueEnabled?: boolean;

  @ApiProperty({
    description:
      'Issue creation mode: per_vulnerability (SCA only), per_vulnerability_type, per_file',
    example: 'per_vulnerability_type',
    required: false,
    enum: ['per_vulnerability', 'per_vulnerability_type', 'per_file'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['per_vulnerability', 'per_vulnerability_type', 'per_file'])
  readonly issueCreationMode?: string;

  @ApiProperty({
    description:
      'Branches for which GitHub/GitLab issues are created. Empty or absent: no GitHub/GitLab issue is created until branches are configured.',
    example: ['main', 'develop'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly issueCreationBranches?: string[];

  @ApiProperty({
    description:
      'Optional security context to apply at creation time (2-step wizard). ' +
      'Reuses the same validation as the update endpoint. Omit to keep defaults.',
    required: false,
    type: ProjectSecurityContextUpdateDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectSecurityContextUpdateDto)
  readonly securityContext?: ProjectSecurityContextUpdateDto;

  @ApiProperty({
    description:
      'The space the project is created from; one of the products this instance serves. Absent: the full scan.',
    enum: PRODUCT_KEYS,
    required: false,
  })
  @IsOptional()
  @IsIn(PRODUCT_KEYS)
  readonly product?: string;

  constructor(
    name: string,
    githubIssueEnabled?: boolean,
    gitlabIssueEnabled?: boolean,
    issueCreationMode?: string,
    issueCreationBranches?: string[],
  ) {
    this.name = name;
    this.githubIssueEnabled = githubIssueEnabled;
    this.gitlabIssueEnabled = gitlabIssueEnabled;
    this.issueCreationMode = issueCreationMode;
    this.issueCreationBranches = issueCreationBranches;
  }

  public toString(): string {
    return JSON.stringify({
      name: this.name,
      githubIssueEnabled: this.githubIssueEnabled,
      gitlabIssueEnabled: this.gitlabIssueEnabled,
      issueCreationMode: this.issueCreationMode,
      issueCreationBranches: this.issueCreationBranches,
    });
  }
}
