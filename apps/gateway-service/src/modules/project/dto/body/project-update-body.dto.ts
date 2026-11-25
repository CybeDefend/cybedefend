import { ApiProperty } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  PROJECT_NAME_MAX_LENGTH,
  ProjectNameRules,
} from './project-name.rules';

/**
 * A reference branch is matched against stored scan branches. It once
 * reached the SQL of the project-list counts, so a value no git
 * branch carries is refused: a quote, a backslash, a control character or
 * `..`. The empty string still clears the setting. global-management's
 * `updateProject` applies the same rule for callers that skip this DTO:
 * change both together.
 */
const REFERENCE_BRANCH_PATTERN = /^(?!.*\.\.)[^'"\\\u0000-\u001f\u007f]*$/;

/**
 * A list setting whose empty array is an explicit "clear": an array of
 * non-empty strings, or null / absent for "not sent". The raw body value is
 * validated (`obj[key]`), not the one the pipe's implicit conversion produced,
 * which would turn `{}` into an empty array, i.e. into a clear.
 */
function ClearableStringList(): PropertyDecorator {
  return applyDecorators(
    Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]),
    IsOptional(),
    IsArray(),
    IsString({ each: true }),
    IsNotEmpty({ each: true }),
  );
}

export class ProjectUpdateBodyDto {
  @ApiProperty({
    description: 'Project name, trimmed, from 1 to 255 characters',
    required: false,
    type: 'string',
    maxLength: PROJECT_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @ProjectNameRules()
  readonly name?: string;

  @ApiProperty({
    description: 'Team unique identifier',
    required: false,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  readonly teamId?: string;

  @ApiProperty({
    description: 'Type of the application',
    required: false,
    enum: ['web_application', 'software', 'mobile_application', 'iot', 'other'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['web_application', 'software', 'mobile_application', 'iot', 'other'])
  readonly applicationType?: string;

  @ApiProperty({
    description: 'Analysis frequency',
    required: false,
    enum: ['weekly', 'daily', 'never'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['weekly', 'daily', 'never'])
  readonly analysisFrequency?: string;

  @ApiProperty({
    description: 'Enable email alert',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly emailAlertEnabled?: boolean;

  @ApiProperty({
    description: 'Enable monthly report',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly monthlyReportEnabled?: boolean;

  @ApiProperty({
    description: 'Enable weekly report',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly weeklyReportEnabled?: boolean;

  @ApiProperty({
    description: 'Enable SAST scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly sastEnabled?: boolean;

  @ApiProperty({
    description: 'Enable DAST scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly dastEnabled?: boolean;

  @ApiProperty({
    description: 'Enable SCA scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scaEnabled?: boolean;

  @ApiProperty({
    description: 'Enable Container scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly containerEnabled?: boolean;

  @ApiProperty({
    description: 'Enable API scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly apiEnabled?: boolean;

  @ApiProperty({
    description: 'Enable IaC scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly iacEnabled?: boolean;

  @ApiProperty({
    description: 'Enable secret detection scan (Gitleaks)',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly secretEnabled?: boolean;

  @ApiProperty({
    description: 'Enable SAST fast scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly sastFastScanEnabled?: boolean;

  @ApiProperty({
    description: 'Default minimum severity for diff scans',
    required: false,
    enum: ['info', 'low', 'medium', 'high', 'critical'],
  })
  @IsOptional()
  @IsIn(['info', 'low', 'medium', 'high', 'critical'])
  readonly diffScanMinSeverity?: string;

  @ApiProperty({
    description: 'Allowed SAST severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  readonly sastSeverities?: string[];

  @ApiProperty({
    description: 'Allowed IaC severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  readonly iacSeverities?: string[];

  @ApiProperty({
    description: 'Allowed SCA severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  readonly scaSeverities?: string[];

  @ApiProperty({
    description: 'Allowed Container severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  readonly containerSeverities?: string[];

  @ApiProperty({
    description: 'Allowed Secret Detection severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn(['critical', 'high', 'medium', 'low'], { each: true })
  readonly secretSeverities?: string[];

  @ApiProperty({
    description: 'Incident creation option',
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  readonly incidentCreationOption?: string;

  @ApiProperty({
    description: 'Enable SCA transitive dependencies scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scaTransitiveDependenciesEnabled?: boolean;

  @ApiProperty({
    description: 'Enable SCA development dependencies scan',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scaDevelopmentDependenciesEnabled?: boolean;

  @ApiProperty({
    description:
      'Enable reachability-based priority adjustment for SCA vulnerabilities',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scaReachabilityPriorityEnabled?: boolean;

  @ApiProperty({
    description:
      'Enable reachability-based status change (unused = ignored) for SCA vulnerabilities',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scaReachabilityStatusEnabled?: boolean;

  @ApiProperty({
    description:
      'Active SAST agent vulnerability categories (full replacement list of internal names)',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  readonly agentCategoriesSast?: string[];

  @ApiProperty({
    description:
      'Active IAC agent vulnerability categories (full replacement list of internal names)',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  readonly agentCategoriesIac?: string[];

  @ApiProperty({
    description:
      'Active CICD agent vulnerability categories (full replacement list of internal names). An empty array disables the CICD agent analysis; leaving the field out, or null, keeps the current list.',
    required: false,
    isArray: true,
    type: 'string',
    nullable: true,
  })
  @ClearableStringList()
  readonly agentCategoriesCicd?: string[];

  @ApiProperty({
    description: 'Enable GitHub issue creation for vulnerabilities',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly githubIssueEnabled?: boolean;

  @ApiProperty({
    description: 'Enable GitLab issue creation for vulnerabilities',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly gitlabIssueEnabled?: boolean;

  @ApiProperty({
    description:
      'Issue creation mode: per_vulnerability (SCA only), per_vulnerability_type, per_file',
    required: false,
    enum: ['per_vulnerability', 'per_vulnerability_type', 'per_file'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['per_vulnerability', 'per_vulnerability_type', 'per_file'])
  readonly issueCreationMode?: string;

  @ApiProperty({
    description:
      'Branches for which GitHub/GitLab issues are created (full replacement list). An empty array clears the list, and with no branch configured no GitHub/GitLab issue is created; leaving the field out, or null, keeps the current list.',
    required: false,
    isArray: true,
    type: 'string',
    nullable: true,
    example: ['main', 'develop'],
  })
  @ClearableStringList()
  readonly issueCreationBranches?: string[];

  @ApiProperty({
    description:
      'Reference branch for vulnerability statistics. When set, vulnerability counts will be filtered to only include vulnerabilities from this branch.',
    required: false,
    type: 'string',
    example: 'main',
    nullable: true,
    maxLength: 191,
  })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  @Matches(REFERENCE_BRANCH_PATTERN, {
    message:
      'referenceBranch must be a git branch name without quotes, backslashes, control characters or ".."',
  })
  readonly referenceBranch?: string | null;

  @ApiProperty({
    description: 'Notification severity threshold filter',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly notifSeverityThreshold?: string[];

  @ApiProperty({
    description: 'Notification scanner types filter',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly notifScannerTypes?: string[];

  @ApiProperty({
    description: 'Enable zero-day email notifications',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly zeroDayEmailEnabled?: boolean;

  @ApiProperty({
    description: 'Enable zero-day Slack notifications',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly zeroDaySlackEnabled?: boolean;

  @ApiProperty({
    description: 'Zero-day severity threshold filter',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly zeroDaySeverityThreshold?: string[];

  @ApiProperty({
    description: 'Enable scan complete email notifications',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly scanCompleteEmailEnabled?: boolean;

  @ApiProperty({
    description: 'Enable scan complete Slack notifications',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly scanCompleteSlackEnabled?: boolean;

  @ApiProperty({
    description: 'Enable weekly report Slack notifications',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly weeklyReportSlackEnabled?: boolean;

  @ApiProperty({
    description: 'Enable monthly report Slack notifications',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly monthlyReportSlackEnabled?: boolean;

  // A closed extension's update field is kept out of this core DTO; the
  // cloud edition applies its decorators and registers it in the
  // update-field registry.

  @ApiProperty({
    description:
      'Trigger an automatic scan on every commit pushed to the monitored branch of the linked GitHub/GitLab repository. Defaults to true.',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scanOnCommitEnabled?: boolean;

  constructor(data: Partial<ProjectUpdateBodyDto>) {
    Object.assign(this, data);
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
