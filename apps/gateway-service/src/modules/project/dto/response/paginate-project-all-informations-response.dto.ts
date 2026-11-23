import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  IsUUID,
} from 'class-validator';

export class MainStatisticsResponseDto {
  @ApiProperty({
    description: 'Number of critical risk projects',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  criticalRiskProjects: number;

  @ApiProperty({
    description: 'Number of critical risk projects in the last 7 days',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  criticalRiskProjectsInLast7Days: number;

  @ApiProperty({ description: 'Number of high risk projects', type: 'number' })
  @IsNumber()
  @IsNotEmpty()
  highRiskProjects: number;

  @ApiProperty({
    description: 'Number of high risk projects in the last 7 days',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  highRiskProjectsInLast7Days: number;

  @ApiProperty({ description: 'Number of solved issues', type: 'number' })
  @IsNumber()
  @IsNotEmpty()
  solvedIssues: number;

  @ApiProperty({
    description: 'Number of solved issues in the last 7 days',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  solvedIssuesInLast7Days: number;

  @ApiProperty({ description: 'Number of new issues', type: 'number' })
  @IsNumber()
  @IsNotEmpty()
  newIssues: number;

  @ApiProperty({
    description: 'Number of new issues in the last 7 days',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  newIssuesInLast7Days: number;

  @ApiProperty({ description: 'Number of critical issues', type: 'number' })
  @IsNumber()
  @IsNotEmpty()
  criticalIssues: number;

  @ApiProperty({
    description: 'Number of high-severity issues',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  highIssues: number;

  @ApiProperty({
    description: 'Number of medium-severity issues',
    type: 'number',
  })
  @IsNumber()
  @IsNotEmpty()
  mediumIssues: number;

  @ApiProperty({ description: 'Number of low-severity issues', type: 'number' })
  @IsNumber()
  @IsNotEmpty()
  lowIssues: number;

  constructor(
    criticalRiskProjects: number,
    criticalRiskProjectsInLast7Days: number,
    highRiskProjects: number,
    highRiskProjectsInLast7Days: number,
    solvedIssues: number,
    solvedIssuesInLast7Days: number,
    newIssues: number,
    newIssuesInLast7Days: number,
    criticalIssues: number,
    highIssues: number,
    mediumIssues: number,
    lowIssues: number,
  ) {
    this.criticalRiskProjects = criticalRiskProjects;
    this.criticalRiskProjectsInLast7Days = criticalRiskProjectsInLast7Days;
    this.highRiskProjects = highRiskProjects;
    this.highRiskProjectsInLast7Days = highRiskProjectsInLast7Days;
    this.solvedIssues = solvedIssues;
    this.solvedIssuesInLast7Days = solvedIssuesInLast7Days;
    this.newIssues = newIssues;
    this.newIssuesInLast7Days = newIssuesInLast7Days;
    this.criticalIssues = criticalIssues;
    this.highIssues = highIssues;
    this.mediumIssues = mediumIssues;
    this.lowIssues = lowIssues;
  }

  toString() {
    return JSON.stringify(this);
  }
}

export class IssueCountResponseDto {
  @ApiProperty({ description: 'Number of critical issues', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  readonly critical: number;

  @ApiProperty({
    description: 'Number of high-severity issues',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  readonly high: number;

  @ApiProperty({
    description: 'Number of medium-severity issues',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  readonly medium: number;

  @ApiProperty({ description: 'Number of low-severity issues', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  readonly low: number;

  constructor(critical: number, high: number, medium: number, low: number) {
    this.critical = critical;
    this.high = high;
    this.medium = medium;
    this.low = low;
  }

  public toString(): string {
    return JSON.stringify({
      critical: this.critical,
      high: this.high,
      medium: this.medium,
      low: this.low,
    });
  }
}

export class AnalysisTypeResponseDto {
  @ApiProperty({ description: 'Type of analysis', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly type: string;

  @ApiProperty({ description: 'Date of the last scan', format: 'date-time' })
  @IsNotEmpty()
  @IsDateString()
  readonly lastScan: Date;

  @ApiProperty({ description: 'Analysis source', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly source: string;

  @ApiProperty({
    description: 'Number of issues by severity',
    type: () => IssueCountResponseDto,
  })
  @IsNotEmpty()
  readonly issuesCount: IssueCountResponseDto;

  constructor(
    type: string,
    lastScan: Date,
    source: string,
    issuesCount: IssueCountResponseDto,
  ) {
    this.type = type;
    this.lastScan = lastScan;
    this.source = source;
    this.issuesCount = issuesCount;
  }

  public toString(): string {
    return JSON.stringify({
      type: this.type,
      lastScan: this.lastScan,
      source: this.source,
      issuesCount: this.issuesCount,
    });
  }
}

export class ProjectAllInformationsResponseDto {
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
  readonly createdAt: Date;

  @ApiProperty({ description: 'Project update date', format: 'date-time' })
  @IsNotEmpty()
  readonly updatedAt: Date;

  @ApiProperty({
    description:
      'CybeRisk level of the project (critical, high, medium, low, none).',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly cyberRiskLevel: string;

  @ApiProperty({
    description:
      'CybeRisk score of the project — unbounded sum of CVSS-based points (not capped at 100).',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  readonly cyberRiskScore: number;

  @ApiProperty({
    description: 'Number of issues by severity',
    type: () => IssueCountResponseDto,
  })
  @IsNotEmpty()
  readonly issuesCount: IssueCountResponseDto;

  @ApiProperty({
    description: 'List of analyses',
    isArray: true,
    type: () => [AnalysisTypeResponseDto],
  })
  @IsNotEmpty()
  readonly analyses: AnalysisTypeResponseDto[];

  @ApiProperty({
    description: 'Ingestion project identifier for parsed projects',
    type: 'string',
    required: false,
  })
  @IsString()
  readonly ingestionProjectId: string;

  @ApiProperty({
    description: 'Indicates if the project is linked to a GitHub repository',
    type: 'boolean',
  })
  readonly isGithubLinked: boolean;

  @ApiProperty({
    description: 'Indicates if the project is linked to a GitLab repository',
    type: 'boolean',
  })
  readonly isGitlabLinked: boolean;

  @ApiProperty({
    description:
      'True when the organization has a Jira installation. Org-scoped — same value for every project in the same org. Lets clients skip a per-page jira/installation lookup.',
    type: 'boolean',
  })
  readonly isJiraLinked: boolean;

  @ApiProperty({
    description:
      'True when the organization has a Linear connection. Org-scoped — same value for every project in the same org. Lets clients skip a per-page linear/installation lookup.',
    type: 'boolean',
  })
  readonly isLinearLinked: boolean;

  @ApiProperty({
    description:
      'Reference branch for vulnerability statistics. When set, vulnerability counts are filtered to this branch only.',
    type: 'string',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  readonly referenceBranch?: string | null;

  constructor(
    projectId: string,
    teamId: string,
    teamName: string,
    name: string,
    createdAt: Date,
    updatedAt: Date,
    cyberRiskLevel: string,
    cyberRiskScore: number,
    issuesCount: IssueCountResponseDto,
    analyses: AnalysisTypeResponseDto[],
    ingestionProjectId: string,
    isGithubLinked: boolean = false,
    isGitlabLinked: boolean = false,
    referenceBranch: string | null = null,
    isJiraLinked: boolean = false,
    isLinearLinked: boolean = false,
  ) {
    this.projectId = projectId;
    this.teamId = teamId;
    this.teamName = teamName;
    this.name = name;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.cyberRiskLevel = cyberRiskLevel;
    this.cyberRiskScore = cyberRiskScore;
    this.issuesCount = issuesCount;
    this.analyses = analyses;
    this.ingestionProjectId = ingestionProjectId;
    this.isGithubLinked = isGithubLinked;
    this.isGitlabLinked = isGitlabLinked;
    this.referenceBranch = referenceBranch;
    this.isJiraLinked = isJiraLinked;
    this.isLinearLinked = isLinearLinked;
  }

  public toString(): string {
    return JSON.stringify({
      id: this.projectId,
      teamId: this.teamId,
      teamName: this.teamName,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      cyberRiskLevel: this.cyberRiskLevel,
      cyberRiskScore: this.cyberRiskScore,
      issuesCount: this.issuesCount,
      analyses: this.analyses,
      ingestionProjectId: this.ingestionProjectId,
      isGithubLinked: this.isGithubLinked,
      isGitlabLinked: this.isGitlabLinked,
      isJiraLinked: this.isJiraLinked,
      isLinearLinked: this.isLinearLinked,
      referenceBranch: this.referenceBranch,
    });
  }
}

export class PaginatedProjectsAllInformationsResponseDto {
  @ApiProperty({
    description: 'List of projects with all informations',
    isArray: true,
    type: () => [ProjectAllInformationsResponseDto],
  })
  @IsNotEmpty()
  readonly projects: ProjectAllInformationsResponseDto[];

  @ApiProperty({ description: 'Total number of projects', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  readonly totalProjects: number;

  @ApiProperty({ description: 'Total number of pages', type: 'number' })
  @IsNotEmpty()
  @IsNumber()
  readonly totalPages: number;

  @ApiProperty({
    description: 'Main statistics',
    type: () => MainStatisticsResponseDto,
  })
  @IsNotEmpty()
  readonly mainStatistics: MainStatisticsResponseDto;

  constructor(
    projects: ProjectAllInformationsResponseDto[],
    totalProjects: number,
    totalPages: number,
    mainStatistics: MainStatisticsResponseDto,
  ) {
    this.projects = projects;
    this.totalProjects = totalProjects;
    this.totalPages = totalPages;
    this.mainStatistics = mainStatistics;
  }

  public toString(): string {
    return JSON.stringify({
      projects: this.projects,
      totalProjects: this.totalProjects,
      totalPages: this.totalPages,
      mainStatistics: this.mainStatistics,
    });
  }
}
