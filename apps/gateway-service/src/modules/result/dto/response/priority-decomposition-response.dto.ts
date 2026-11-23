import { ApiProperty } from '@nestjs/swagger';

export class PriorityDecompositionDto {
  @ApiProperty({ description: 'Computed priority level' })
  priority: string;

  @ApiProperty({ description: 'Composite score (0-1)' })
  compositeScore: number;

  @ApiProperty({ description: 'CVSS4 contribution to composite score' })
  cvss4Contribution: number;

  @ApiProperty({ description: 'EPSS contribution to composite score' })
  epssContribution: number;

  @ApiProperty({
    description: 'Exploitability contribution to composite score',
  })
  exploitContribution: number;

  @ApiProperty({ description: 'Context contribution to composite score' })
  contextContribution: number;

  @ApiProperty({ description: 'Weight for CVSS4' })
  w1: number;

  @ApiProperty({ description: 'Weight for EPSS' })
  w2: number;

  @ApiProperty({ description: 'Weight for exploitability' })
  w3: number;

  @ApiProperty({ description: 'Weight for context' })
  w4: number;

  @ApiProperty({ description: 'Whether priority was manually overridden' })
  isManualOverride: boolean;
}

export class PriorityDecompositionResponseDto {
  @ApiProperty({ type: PriorityDecompositionDto })
  decomposition: PriorityDecompositionDto;
}
