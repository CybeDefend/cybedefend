import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CvssBaseExplanationDto {
  @ApiProperty({ enum: ['critical', 'high', 'medium', 'low', 'none'] })
  severity: string;

  @ApiProperty({ example: 8.8 })
  baseScore: number;

  @ApiProperty({
    enum: ['network', 'adjacent', 'local', 'physical'],
    description: 'Derived from AV',
  })
  attackOrigin: string;

  @ApiProperty({ enum: ['low', 'high'], description: 'Derived from AC' })
  attackComplexity: string;

  @ApiProperty({
    enum: ['none', 'low', 'high'],
    description: 'Derived from PR',
  })
  authRequired: string;

  @ApiProperty({
    enum: ['none', 'passive', 'active'],
    description: 'Derived from UI',
  })
  userInteraction: string;

  @ApiProperty({ enum: ['none', 'low', 'high'], description: 'From VC' })
  confidentialityImpact: string;

  @ApiProperty({ enum: ['none', 'low', 'high'], description: 'From VI' })
  integrityImpact: string;

  @ApiProperty({ enum: ['none', 'low', 'high'], description: 'From VA' })
  availabilityImpact: string;

  @ApiProperty({ description: 'True when SC|SI|SA != N' })
  hasSubsequentImpact: boolean;
}

export class CvssEnvDriverDto {
  @ApiProperty({ example: 'CR' })
  metricKey: string;

  @ApiProperty({ example: 'L' })
  value: string;

  @ApiPropertyOptional({
    description: 'For M* metrics: corresponding base key (e.g. AV for MAV)',
  })
  baseKey?: string;

  @ApiPropertyOptional({ description: 'Value of base_key in the base vector' })
  baseValue?: string;

  @ApiProperty({ enum: ['increases', 'decreases', 'neutral'] })
  effect: string;
}

export class CvssEnvironmentalExplanationDto {
  @ApiProperty({ example: 8.7 })
  envScore: number;

  @ApiProperty({ example: 8.8 })
  baseScore: number;

  @ApiProperty({
    description: 'env - base, rounded to 1 decimal',
    example: -0.1,
  })
  scoreDelta: number;

  @ApiProperty({ enum: ['increased', 'decreased', 'unchanged'] })
  direction: string;

  @ApiProperty({ type: [CvssEnvDriverDto] })
  drivers: CvssEnvDriverDto[];
}

export class CvssExplanationDto {
  @ApiPropertyOptional({ type: CvssBaseExplanationDto })
  base?: CvssBaseExplanationDto;

  @ApiPropertyOptional({ type: CvssEnvironmentalExplanationDto })
  environmental?: CvssEnvironmentalExplanationDto;
}
