import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CvssExplanationDto } from './cvss-explanation.dto';

export class SeverityBreakdownDto {
  @ApiProperty({
    description: 'Number of critical vulnerabilities',
    example: 5,
  })
  critical: number;

  @ApiProperty({ description: 'Number of high vulnerabilities', example: 10 })
  high: number;

  @ApiProperty({ description: 'Number of medium vulnerabilities', example: 20 })
  medium: number;

  @ApiProperty({ description: 'Number of low vulnerabilities', example: 15 })
  low: number;
}

export class VulnerabilityOccurrenceDto {
  @ApiProperty({ description: 'Detection ID', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'File path', example: 'src/controllers/user.ts' })
  path: string;

  @ApiProperty({ description: 'Start line of vulnerable code', example: 42 })
  vulnerableStartLine: number;

  @ApiProperty({ description: 'End line of vulnerable code', example: 50 })
  vulnerableEndLine: number;

  @ApiProperty({ description: 'Current state', example: 'to_verify' })
  currentState: string;

  @ApiProperty({ description: 'Current severity', example: 'high' })
  currentSeverity: string;

  @ApiProperty({ description: 'Current priority', example: 'urgent' })
  currentPriority: string;

  @ApiPropertyOptional({ description: 'Priority score (0-100)', example: 76.9 })
  priorityScore?: number;

  @ApiProperty({ description: 'Detection creation date' })
  createdAt: string;

  @ApiPropertyOptional({ description: 'Autofix records if available' })
  autofixRecords?: any[];

  @ApiPropertyOptional({ description: 'CVSS 4.0 base score', example: 7.5 })
  cvss4BaseScore?: number;

  @ApiPropertyOptional({
    description: 'CVSS 4.0 environmental score',
    example: 8.0,
  })
  cvss4EnvironmentalScore?: number;

  @ApiPropertyOptional({
    description: 'Exploitability verdict',
    example: 'theoretical',
  })
  exploitabilityVerdict?: string;

  @ApiPropertyOptional({
    description: 'Exploitability score (0-1)',
    example: 0.6,
  })
  exploitabilityScore?: number;

  @ApiPropertyOptional({
    type: 'string',
    description:
      'Source of the exploitability verdict: agent | manual | static',
    example: 'agent',
  })
  exploitabilitySource?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'date-time',
    description: 'Date of the exploitability verdict (ISO 8601)',
    example: '2026-09-23T09:53:40.000Z',
  })
  exploitabilityUpdatedAt?: string;

  @ApiPropertyOptional({
    type: 'boolean',
    description:
      'True when an agent verdict predates the latest update of the project security context',
  })
  exploitabilityStale?: boolean;

  @ApiPropertyOptional({
    description:
      'Plain-language CVSS explanation (structured data, FR/EN composed dashboard-side)',
    type: CvssExplanationDto,
  })
  cvssExplanation?: CvssExplanationDto;
}

export class GroupedVulnerabilityDto {
  @ApiProperty({ description: 'Rule/Vulnerability ID', format: 'uuid' })
  ruleId: string;

  @ApiPropertyOptional({ description: 'Vulnerability metadata' })
  vulnerability?: any;

  @ApiProperty({ description: 'Number of occurrences', example: 5 })
  occurrenceCount: number;

  @ApiProperty({
    description: 'Severity breakdown',
    type: SeverityBreakdownDto,
  })
  severityBreakdown: SeverityBreakdownDto;

  @ApiProperty({
    description: 'Highest severity among occurrences',
    example: 'critical',
  })
  highestSeverity: string;

  @ApiProperty({ description: 'Programming language', example: 'javascript' })
  language: string;

  @ApiProperty({
    description: 'All occurrences',
    type: [VulnerabilityOccurrenceDto],
  })
  occurrences: VulnerabilityOccurrenceDto[];

  @ApiProperty({
    description: 'Whether any occurrence has autofix',
    example: true,
  })
  hasAutofix: boolean;

  @ApiProperty({ description: 'First detection date' })
  firstSeen: string;

  @ApiProperty({ description: 'Last detection date' })
  lastSeen: string;

  @ApiPropertyOptional({
    description: 'Highest CVSS4 score in group',
    example: 9.1,
  })
  highestCvss4?: number;

  @ApiPropertyOptional({
    description: 'Highest exploitability verdict in group',
    example: 'theoretical',
  })
  highestExploitabilityVerdict?: string;
}

export class ScaVulnerabilityOccurrenceDto {
  @ApiProperty({ description: 'Detection ID', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'File path', example: 'package.json' })
  path: string;

  @ApiProperty({ description: 'Package version', example: '1.2.3' })
  packageVersion: string;

  @ApiProperty({ description: 'Current state', example: 'to_verify' })
  currentState: string;

  @ApiProperty({ description: 'Current severity', example: 'high' })
  currentSeverity: string;

  @ApiProperty({ description: 'Current priority', example: 'urgent' })
  currentPriority: string;

  @ApiPropertyOptional({ description: 'Priority score (0-100)', example: 76.9 })
  priorityScore?: number;

  @ApiProperty({ description: 'CVSS score', example: 7.5 })
  currentCvss: number;

  @ApiProperty({ description: 'Detection creation date' })
  createdAt: string;

  @ApiProperty({ description: 'Is dev dependency', example: false })
  isDev: boolean;

  @ApiProperty({ description: 'Is transitive dependency', example: true })
  isTransitive: boolean;

  @ApiPropertyOptional({
    description: 'Exploitability verdict',
    example: 'theoretical',
  })
  exploitabilityVerdict?: string;

  @ApiPropertyOptional({
    description: 'Exploitability score (0-1)',
    example: 0.6,
  })
  exploitabilityScore?: number;

  @ApiPropertyOptional({
    description:
      'Plain-language CVSS explanation (structured data, FR/EN composed dashboard-side)',
    type: CvssExplanationDto,
  })
  cvssExplanation?: CvssExplanationDto;
}

export class GroupedScaVulnerabilityDto {
  @ApiProperty({ description: 'CVE ID', example: 'CVE-2023-1234' })
  cveId: string;

  @ApiProperty({ description: 'Package name', example: 'lodash' })
  packageName: string;

  @ApiPropertyOptional({ description: 'Vulnerability metadata' })
  vulnerability?: any;

  @ApiProperty({ description: 'Number of occurrences', example: 3 })
  occurrenceCount: number;

  @ApiProperty({
    description: 'Severity breakdown',
    type: SeverityBreakdownDto,
  })
  severityBreakdown: SeverityBreakdownDto;

  @ApiProperty({ description: 'Highest severity', example: 'high' })
  highestSeverity: string;

  @ApiProperty({ description: 'Highest CVSS score', example: 9.1 })
  highestCvss: number;

  @ApiProperty({ description: 'Number of dev dependencies', example: 1 })
  devCount: number;

  @ApiProperty({ description: 'Number of direct dependencies', example: 2 })
  directCount: number;

  @ApiProperty({ description: 'Number of transitive dependencies', example: 5 })
  transitiveCount: number;

  @ApiProperty({
    description: 'All occurrences',
    type: [ScaVulnerabilityOccurrenceDto],
  })
  occurrences: ScaVulnerabilityOccurrenceDto[];

  @ApiProperty({ description: 'First detection date' })
  firstSeen: string;

  @ApiProperty({ description: 'Last detection date' })
  lastSeen: string;

  @ApiProperty({ description: 'Whether a fix is available', example: true })
  hasFix: boolean;

  @ApiPropertyOptional({
    description: 'Highest exploitability verdict in group',
    example: 'theoretical',
  })
  highestExploitabilityVerdict?: string;
}

export class GetGroupedVulnerabilitiesResponseDto {
  @ApiProperty({ description: 'Project ID', format: 'uuid' })
  projectId: string;

  @ApiProperty({ description: 'Project name', example: 'my-project' })
  projectName: string;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 5 })
  totalPages: number;

  @ApiProperty({ description: 'Sort field', example: 'occurrenceCount' })
  sort: string;

  @ApiProperty({ description: 'Sort order', example: 'DESC' })
  order: string;

  @ApiProperty({ description: 'Applied severity filters', type: [String] })
  severity: string[];

  @ApiProperty({ description: 'Applied status filters', type: [String] })
  status: string[];

  @ApiProperty({ description: 'Applied priority filters', type: [String] })
  priority: string[];

  @ApiProperty({
    type: [String],
    description:
      'Distinct languages present for this project/type (populates the language filter dropdown, independent of pagination and filters).',
  })
  languages: string[];

  @ApiProperty({
    description: 'Grouped vulnerabilities',
    type: [GroupedVulnerabilityDto],
  })
  groupedVulnerabilities: GroupedVulnerabilityDto[];

  @ApiProperty({ description: 'Total number of groups', example: 50 })
  total: number;

  @ApiProperty({
    description: 'Total number of occurrences across all groups',
    example: 200,
  })
  totalOccurrences: number;

  @ApiPropertyOptional({ description: 'Scan project info' })
  scanProjectInfo?: any;

  @ApiPropertyOptional({ description: 'Vulnerability count by type' })
  vulnCountByType?: any;

  @ApiPropertyOptional({ description: 'Whether project has been parsed' })
  isProjectParsed?: boolean;

  @ApiPropertyOptional({ description: 'Autofix count by type' })
  autofixCountByType?: any;
}

export class GetGroupedScaVulnerabilitiesResponseDto {
  @ApiProperty({ description: 'Project ID', format: 'uuid' })
  projectId: string;

  @ApiProperty({ description: 'Project name', example: 'my-project' })
  projectName: string;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 5 })
  totalPages: number;

  @ApiProperty({ description: 'Sort field', example: 'occurrenceCount' })
  sort: string;

  @ApiProperty({ description: 'Sort order', example: 'DESC' })
  order: string;

  @ApiProperty({ description: 'Applied severity filters', type: [String] })
  severity: string[];

  @ApiProperty({ description: 'Applied status filters', type: [String] })
  status: string[];

  @ApiProperty({ description: 'Applied priority filters', type: [String] })
  priority: string[];

  @ApiProperty({
    description: 'Grouped SCA vulnerabilities',
    type: [GroupedScaVulnerabilityDto],
  })
  groupedVulnerabilities: GroupedScaVulnerabilityDto[];

  @ApiProperty({ description: 'Total number of groups', example: 30 })
  total: number;

  @ApiProperty({ description: 'Total number of occurrences', example: 100 })
  totalOccurrences: number;

  @ApiPropertyOptional({ description: 'Scan project info' })
  scanProjectInfo?: any;

  @ApiPropertyOptional({ description: 'Vulnerability count by type' })
  vulnCountByType?: any;

  @ApiPropertyOptional({ description: 'Whether project has been parsed' })
  isProjectParsed?: boolean;

  @ApiPropertyOptional({
    description:
      'Count of vulnerabilities auto-ignored due to unused reachability',
    example: 5,
  })
  reachabilityIgnoredCount?: number;
}

export class ContainerVulnerabilityOccurrenceDto {
  @ApiProperty({ description: 'Detection ID', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'CVE ID', example: 'CVE-2026-1234' })
  vulnerabilityId: string;

  @ApiProperty({ description: 'Current state', example: 'to_verify' })
  currentState: string;

  @ApiProperty({ description: 'Current severity', example: 'high' })
  currentSeverity: string;

  @ApiProperty({ description: 'Current priority', example: 'urgent' })
  currentPriority: string;

  @ApiProperty({ description: 'Recommended fixed version', example: '6.3.0' })
  fixedVersion: string;

  @ApiProperty({ description: 'Detection creation date' })
  createdAt: string;

  @ApiPropertyOptional({
    description: 'Legacy CVSS v3 base score',
    example: 7.5,
  })
  cvssScore?: number;

  @ApiPropertyOptional({ description: 'CVSS v4 base score', example: 8.1 })
  cvss4BaseScore?: number;

  @ApiPropertyOptional({
    description: 'CVSS v4 environmental score',
    example: 7.9,
  })
  cvss4EnvironmentalScore?: number;

  @ApiPropertyOptional({ description: 'EPSS score (0-1)', example: 0.0123 })
  epssScore?: number;

  @ApiPropertyOptional({ description: 'Priority score (0-100)', example: 76.9 })
  priorityScore?: number;

  @ApiPropertyOptional({
    description: 'Exploitability verdict',
    example: 'theoretical',
  })
  exploitabilityVerdict?: string;

  @ApiPropertyOptional({
    description: 'Exploitability score (0-1)',
    example: 0.6,
  })
  exploitabilityScore?: number;
}

export class GroupedContainerVulnerabilityDto {
  @ApiProperty({ description: 'Package name', example: 'tar' })
  packageName: string;

  @ApiProperty({ description: 'Package version', example: '6.2.1' })
  packageVersion: string;

  @ApiProperty({ description: 'Package class', example: 'lang-pkgs' })
  packageClass: string;

  @ApiProperty({
    description: 'Number of CVEs affecting the package',
    example: 3,
  })
  occurrenceCount: number;

  @ApiProperty({
    description: 'Severity breakdown',
    type: SeverityBreakdownDto,
  })
  severityBreakdown: SeverityBreakdownDto;

  @ApiProperty({ description: 'Highest severity', example: 'critical' })
  highestSeverity: string;

  @ApiProperty({ description: 'Highest CVSS score', example: 9.8 })
  highestCvss: number;

  @ApiProperty({
    description: 'All CVE occurrences for the package',
    type: [ContainerVulnerabilityOccurrenceDto],
  })
  occurrences: ContainerVulnerabilityOccurrenceDto[];

  @ApiProperty({ description: 'First detection date' })
  firstSeen: string;

  @ApiProperty({ description: 'Last detection date' })
  lastSeen: string;

  @ApiProperty({ description: 'Whether a fix is available', example: true })
  hasFix: boolean;

  @ApiProperty({
    description: 'Whether Cybe analyzed the package',
    example: false,
  })
  hasCybeAnalysis: boolean;

  @ApiPropertyOptional({
    description: 'Highest exploitability verdict in group',
    example: 'theoretical',
  })
  highestExploitabilityVerdict?: string;

  @ApiPropertyOptional({ description: 'Highest CVSS v4 score', example: 9.3 })
  highestCvss4?: number;
}

export class GetGroupedContainerVulnerabilitiesResponseDto {
  @ApiProperty({ description: 'Project ID', format: 'uuid' })
  projectId: string;

  @ApiProperty({ description: 'Project name', example: 'my-project' })
  projectName: string;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Page size', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 5 })
  totalPages: number;

  @ApiProperty({ description: 'Sort field', example: 'currentSeverity' })
  sort: string;

  @ApiProperty({ description: 'Sort order', example: 'DESC' })
  order: string;

  @ApiProperty({ description: 'Applied severity filters', type: [String] })
  severity: string[];

  @ApiProperty({ description: 'Applied status filters', type: [String] })
  status: string[];

  @ApiProperty({ description: 'Applied priority filters', type: [String] })
  priority: string[];

  @ApiProperty({
    description: 'Grouped container vulnerabilities (by package)',
    type: [GroupedContainerVulnerabilityDto],
  })
  groupedVulnerabilities: GroupedContainerVulnerabilityDto[];

  @ApiProperty({ description: 'Total number of groups', example: 12 })
  total: number;

  @ApiProperty({ description: 'Total number of occurrences', example: 39 })
  totalOccurrences: number;

  @ApiPropertyOptional({ description: 'Scan project info' })
  scanProjectInfo?: any;

  @ApiPropertyOptional({ description: 'Vulnerability count by type' })
  vulnCountByType?: any;
}

export class GetVulnerabilityWithSimilarResponseDto {
  @ApiProperty({ description: 'Project ID', format: 'uuid' })
  projectId: string;

  @ApiProperty({ description: 'Vulnerability ID', format: 'uuid' })
  vulnerabilityId: string;

  @ApiPropertyOptional({ description: 'SAST vulnerability if applicable' })
  sast?: any;

  @ApiPropertyOptional({ description: 'IAC vulnerability if applicable' })
  iac?: any;

  @ApiPropertyOptional({ description: 'SCA vulnerability if applicable' })
  sca?: any;

  @ApiPropertyOptional({ description: 'CICD vulnerability if applicable' })
  cicd?: any;

  @ApiPropertyOptional({ description: 'Secret vulnerability if applicable' })
  secret?: any;

  @ApiPropertyOptional({ description: 'Whether project has been parsed' })
  isProjectParsed?: boolean;

  @ApiProperty({
    description: 'Similar occurrences',
    type: [VulnerabilityOccurrenceDto],
  })
  similarOccurrences: VulnerabilityOccurrenceDto[];

  @ApiProperty({
    description: 'Total number of similar occurrences',
    example: 5,
  })
  totalSimilar: number;
}
