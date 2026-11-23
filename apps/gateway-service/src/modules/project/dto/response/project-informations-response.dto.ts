// src/global-management/project/response/project-informations-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
} from 'class-validator';

export class ProjectInformationsResponseDto {
  @ApiProperty({ description: 'Project unique identifier', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  readonly projectId: string;

  @ApiProperty({ description: 'Team unique identifier', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  readonly teamId: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly teamName: string;

  @ApiProperty({ description: 'Project name', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly name: string;

  @ApiProperty({ description: 'Project creation date', format: 'date-time' })
  @IsNotEmpty()
  @IsDateString()
  readonly createdAt: Date;

  @ApiProperty({ description: 'Project last update date', format: 'date-time' })
  @IsNotEmpty()
  @IsDateString()
  readonly updatedAt: Date;

  @ApiProperty({
    description: 'Risk score of the project (0-100)',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  readonly riskScore: number;

  @ApiProperty({ description: 'Risk level of the project', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly riskLevel: string;

  @ApiProperty({
    description: 'Application type',
    required: false,
    enum: ['web_application', 'software', 'mobile_application', 'iot', 'other'],
  })
  @IsOptional()
  @IsString()
  readonly applicationType?: string;

  @ApiProperty({
    description: 'Analysis frequency',
    required: false,
    enum: ['weekly', 'daily', 'never'],
  })
  @IsOptional()
  @IsString()
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

  @ApiProperty({ description: 'Enable SAST', required: false, type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  readonly sastEnabled?: boolean;

  @ApiProperty({ description: 'Enable DAST', required: false, type: 'boolean' })
  @IsOptional()
  @IsBoolean()
  readonly dastEnabled?: boolean;

  @ApiProperty({ description: 'Enable SCA', required: false, type: 'boolean' })
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
    description:
      'Trigger an automatic scan on every commit pushed to the monitored branch of the linked GitHub/GitLab repository',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly scanOnCommitEnabled?: boolean;

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
  })
  @IsOptional()
  readonly diffScanMinSeverity?: string;

  @ApiProperty({
    description: 'Allowed SAST severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly sastSeverities?: string[];

  @ApiProperty({
    description: 'Allowed SCA severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly scaSeverities?: string[];

  @ApiProperty({
    description: 'Allowed IaC severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly iacSeverities?: string[];

  @ApiProperty({
    description: 'Allowed Container severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly containerSeverities?: string[];

  @ApiProperty({
    description: 'Allowed Secret Detection severities',
    required: false,
    isArray: true,
    enum: ['critical', 'high', 'medium', 'low'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
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
    description: 'Active SAST agent vulnerability categories (internal names)',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly agentCategoriesSast?: string[];

  @ApiProperty({
    description: 'Active IAC agent vulnerability categories (internal names)',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly agentCategoriesIac?: string[];

  @ApiProperty({
    description: 'Active CICD agent vulnerability categories (internal names)',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly agentCategoriesCicd?: string[];

  @ApiProperty({
    description: 'Enable GitHub issue creation',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly githubIssueEnabled?: boolean;

  @ApiProperty({
    description: 'Enable GitLab issue creation',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly gitlabIssueEnabled?: boolean;

  @ApiProperty({
    description: 'Issue creation mode',
    required: false,
    enum: ['per_vulnerability', 'per_vulnerability_type', 'per_file'],
  })
  @IsOptional()
  @IsString()
  readonly issueCreationMode?: string;

  @ApiProperty({
    description:
      'List of branches for which issues should be created. Empty means all branches.',
    required: false,
    isArray: true,
    type: 'string',
    example: ['main', 'develop'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly issueCreationBranches?: string[];

  @ApiProperty({
    description:
      'Reference branch for vulnerability statistics. When set, vulnerability counts will be filtered to only include vulnerabilities from this branch.',
    required: false,
    type: 'string',
    example: 'main',
    nullable: true,
  })
  @IsOptional()
  @IsString()
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
    description: 'Zero-day email notifications enabled',
    required: false,
  })
  @IsOptional()
  readonly zeroDayEmailEnabled?: boolean;

  @ApiProperty({
    description: 'Zero-day Slack notifications enabled',
    required: false,
  })
  @IsOptional()
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
    description: 'Scan complete email notifications enabled',
    required: false,
  })
  @IsOptional()
  readonly scanCompleteEmailEnabled?: boolean;

  @ApiProperty({
    description: 'Scan complete Slack notifications enabled',
    required: false,
  })
  @IsOptional()
  readonly scanCompleteSlackEnabled?: boolean;

  @ApiProperty({
    description: 'Weekly report Slack notifications enabled',
    required: false,
  })
  @IsOptional()
  readonly weeklyReportSlackEnabled?: boolean;

  @ApiProperty({
    description: 'Monthly report Slack notifications enabled',
    required: false,
  })
  @IsOptional()
  readonly monthlyReportSlackEnabled?: boolean;

  @ApiProperty({
    description: 'Distinct programming languages detected in the project',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  readonly detectedLanguages?: string[];

  @ApiProperty({
    description:
      'Whether Code Graph and the closed product are available (project uses at least one supported language; optimistic true when none detected yet)',
    type: 'boolean',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  readonly codeGraphSupported?: boolean;

  constructor(
    projectId: string,
    teamId: string,
    teamName: string,
    name: string,
    createdAt: Date,
    updatedAt: Date,
    additionalFields: {
      applicationType?: string;
      analysisFrequency?: string;
      emailAlertEnabled?: boolean;
      monthlyReportEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      sastEnabled?: boolean;
      dastEnabled?: boolean;
      scaEnabled?: boolean;
      containerEnabled?: boolean;
      apiEnabled?: boolean;
      iacEnabled?: boolean;
      secretEnabled?: boolean;
      scanOnCommitEnabled?: boolean;
      sastFastScanEnabled?: boolean;
      diffScanMinSeverity?: string;
      sastSeverities?: string[];
      scaSeverities?: string[];
      iacSeverities?: string[];
      containerSeverities?: string[];
      secretSeverities?: string[];
      incidentCreationOption?: string;
      scaTransitiveDependenciesEnabled?: boolean;
      scaDevelopmentDependenciesEnabled?: boolean;
      scaReachabilityPriorityEnabled?: boolean;
      scaReachabilityStatusEnabled?: boolean;
      agentCategoriesSast?: string[];
      agentCategoriesIac?: string[];
      agentCategoriesCicd?: string[];
      githubIssueEnabled?: boolean;
      gitlabIssueEnabled?: boolean;
      issueCreationMode?: string;
      issueCreationBranches?: string[];
      referenceBranch?: string | null;
      notifSeverityThreshold?: string[];
      notifScannerTypes?: string[];
      zeroDayEmailEnabled?: boolean;
      zeroDaySlackEnabled?: boolean;
      zeroDaySeverityThreshold?: string[];
      scanCompleteEmailEnabled?: boolean;
      scanCompleteSlackEnabled?: boolean;
      weeklyReportSlackEnabled?: boolean;
      monthlyReportSlackEnabled?: boolean;
    } = {},
  ) {
    this.projectId = projectId;
    this.teamId = teamId;
    this.teamName = teamName;
    this.name = name;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    Object.assign(this, additionalFields);
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
