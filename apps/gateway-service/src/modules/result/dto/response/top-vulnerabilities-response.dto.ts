import { ApiProperty } from '@nestjs/swagger';

export class TopVulnerabilityItemDto {
  @ApiProperty({ description: 'Vulnerability detection ID' })
  id: string;

  @ApiProperty({ description: 'Type: sca, sast, iac, container, cicd, secret' })
  vulnerabilityType: string;

  @ApiProperty({ description: 'Vulnerability name' })
  name: string;

  @ApiProperty({ description: 'Short description' })
  description: string;

  @ApiProperty({ description: 'Severity level' })
  severity: string;

  @ApiProperty({ description: 'Composite priority score (0-1)' })
  compositeScore: number;

  @ApiProperty({ required: false })
  cvss4EnvironmentalScore?: number;

  @ApiProperty({ required: false })
  exploitabilityVerdict?: string;

  @ApiProperty({ required: false })
  exploitabilityReason?: string;

  @ApiProperty({
    required: false,
    description:
      'LLM reasoning for the exploitability score (separate from exploitabilityReason which justifies the TP/FP verdict)',
  })
  exploitabilityScoreReason?: string;

  @ApiProperty({
    required: false,
    description: 'Source of exploitability: agent | manual | static',
  })
  exploitabilitySource?: string;

  @ApiProperty({ required: false })
  filePath?: string;

  @ApiProperty({ required: false })
  line?: number;

  @ApiProperty({ required: false })
  cveId?: string;

  @ApiProperty({ required: false, type: [String] })
  cwe?: string[];

  @ApiProperty({ required: false })
  packageName?: string;
}

export class TopVulnerabilitiesResponseDto {
  @ApiProperty({ type: [TopVulnerabilityItemDto] })
  items: TopVulnerabilityItemDto[];
}
