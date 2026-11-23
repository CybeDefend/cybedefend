import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ViolationDetailDto {
  @ApiProperty({ description: 'Rule ID that was violated' })
  ruleId: string;

  @ApiProperty({ description: 'Rule name' })
  ruleName: string;

  @ApiProperty({ description: 'Description of the violation' })
  description: string;

  @ApiProperty({ description: 'Rule condition that triggered the violation' })
  condition: string;
}

/**
 * DTO for child rule criteria in composite rules
 */
export class RuleCriterionDto {
  @ApiProperty({ description: 'Child rule ID' })
  id: string;

  @ApiProperty({ description: 'Child rule name' })
  name: string;

  @ApiPropertyOptional({ description: 'Child rule description' })
  description?: string;

  @ApiProperty({
    description:
      'Child rule type (severity, cvss_score, cwe, vulnerability_age_days, etc.)',
  })
  type: string;

  @ApiPropertyOptional({
    description: 'Rule value (severity level, cvss threshold, etc.)',
  })
  value?: unknown;

  @ApiPropertyOptional({
    description: 'Operator (equals, gte, lte, contains, etc.)',
  })
  operator?: string;
}

export class PolicyRuleResponseDto {
  @ApiProperty({ description: 'Rule ID' })
  id: string;

  @ApiProperty({ description: 'Rule name' })
  name: string;

  @ApiPropertyOptional({ description: 'Rule description' })
  description?: string;

  @ApiProperty({ description: 'Rule type' })
  type: string;

  @ApiPropertyOptional({ description: 'Rule value (for non-composite rules)' })
  value?: unknown;

  @ApiProperty({ description: 'Action taken (WARN or BLOCK)' })
  action: string;

  @ApiPropertyOptional({ description: 'Operator (for non-composite rules)' })
  operator?: string;

  @ApiPropertyOptional({
    description: 'Child rule criteria (for composite_and / composite_or rules)',
    type: [RuleCriterionDto],
  })
  criteria?: RuleCriterionDto[];
}

export class UserProfileDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'First name' })
  firstName: string;

  @ApiProperty({ description: 'Last name' })
  lastName: string;

  @ApiProperty({ description: 'Email address' })
  email: string;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  avatarUrl?: string;
}

export class AffectedVulnerabilityDto {
  @ApiProperty({ description: 'Vulnerability ID' })
  id: string;

  @ApiProperty({ description: 'Vulnerability name/title' })
  name: string;

  @ApiProperty({
    description: 'Severity level (CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL)',
  })
  severity: string;

  @ApiPropertyOptional({ description: 'CVSS score (0-10)' })
  cvssScore?: number;

  @ApiPropertyOptional({ description: 'CWE identifiers', type: [String] })
  cwe?: string[];

  @ApiPropertyOptional({
    description: 'OWASP Top 10 categories',
    type: [String],
  })
  owaspTop10?: string[];

  @ApiPropertyOptional({
    description: 'File path where vulnerability was found',
  })
  filePath?: string;

  @ApiPropertyOptional({ description: 'Start line number' })
  startLine?: number;

  @ApiPropertyOptional({ description: 'End line number' })
  endLine?: number;

  @ApiProperty({
    description: 'Vulnerability type (sast, iac, sca, secret, cicd, container)',
  })
  vulnerabilityType: string;

  @ApiPropertyOptional({ description: 'Branch where vulnerability was found' })
  branch?: string;

  @ApiPropertyOptional({
    description: 'Package name (for SCA vulnerabilities)',
  })
  packageName?: string;

  @ApiPropertyOptional({
    description: 'Package version (for SCA vulnerabilities)',
  })
  packageVersion?: string;

  @ApiPropertyOptional({
    description: 'Artifact name (for Container vulnerabilities)',
  })
  artifactName?: string;
}

export class ViolationDto {
  @ApiProperty({
    description: 'Violation ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Policy ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  policyId: string;

  @ApiProperty({
    description: 'Project ID',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  projectId: string;

  @ApiProperty({
    description: 'Scan ID',
    example: '550e8400-e29b-41d4-a716-446655440003',
  })
  scanId: string;

  @ApiProperty({
    description: 'Organization ID',
    example: '550e8400-e29b-41d4-a716-446655440004',
  })
  organizationId: string;

  @ApiProperty({
    description: 'Action taken (WARN or BLOCK)',
    enum: ['WARN', 'BLOCK'],
    example: 'BLOCK',
  })
  actionTaken: string;

  @ApiProperty({
    description: 'Number of vulnerabilities affected by this violation',
    example: 12,
  })
  affectedVulnerabilitiesCount: number;

  @ApiProperty({
    description: 'The rule that was violated',
    type: PolicyRuleResponseDto,
  })
  rule: PolicyRuleResponseDto;

  @ApiPropertyOptional({
    description: 'List of affected vulnerabilities',
    type: [AffectedVulnerabilityDto],
  })
  affectedVulnerabilities?: AffectedVulnerabilityDto[];

  @ApiProperty({
    description: 'Creation timestamp (ISO 8601)',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Last update timestamp (ISO 8601)',
    example: '2024-01-15T10:30:00Z',
  })
  updatedAt: string;
}

export class ViolationListResponseDto {
  @ApiProperty({
    description: 'List of violations',
    type: [ViolationDto],
  })
  violations: ViolationDto[];

  @ApiProperty({
    description: 'Total count',
    example: 10,
  })
  total: number;

  @ApiProperty({
    description: 'Current page',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Page size',
    example: 50,
  })
  limit: number;
}

export class ViolationStatsDto {
  @ApiProperty({
    description: 'Total violations',
    example: 100,
  })
  totalViolations: number;

  @ApiProperty({
    description: 'Number of violations with BLOCK action',
    example: 30,
  })
  blockedCount: number;

  @ApiProperty({
    description: 'Number of violations with WARN action',
    example: 70,
  })
  warnedCount: number;

  @ApiProperty({
    description: 'Number of applicable policies for this project',
    example: 5,
  })
  applicablePoliciesCount: number;

  @ApiProperty({
    description: 'Compliance status',
    example: 'Compliant',
    enum: ['Compliant', 'Non-Compliant', 'Pending'],
  })
  complianceStatus: string;
}
