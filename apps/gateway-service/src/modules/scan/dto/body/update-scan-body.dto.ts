// src/global-management/scan/body/update-scan-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateScanBodyDto {
  @ApiProperty({
    description: 'State of the scan',
    enum: ['queued', 'running', 'completed', 'failed'],
  })
  @IsEnum(['queued', 'running', 'completed', 'failed'])
  @IsNotEmpty()
  state: string;

  @ApiProperty({
    description: 'Date when the scan started',
    format: 'date-time',
    required: false,
  })
  @IsOptional()
  @IsString()
  startedAt?: string;

  @ApiProperty({
    description: 'Cluster identifier',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  clusterId?: string;

  @ApiProperty({
    description: 'Pod identifier',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  podId?: string;

  @ApiProperty({ description: 'Pod name', required: false, type: 'string' })
  @IsString()
  @IsOptional()
  podName?: string;

  @ApiProperty({
    description: 'Docker image used',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiProperty({
    description: 'Docker image version',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  version?: string;

  @ApiProperty({
    description: 'Total number of vulnerabilities identified so far',
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  totalVulnerabilities?: number;

  @ApiProperty({
    description: 'Number of vulnerabilities processed so far',
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  processedVulnerabilities?: number;

  @ApiProperty({
    description: 'Current step of the scan',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  step?: string;

  toString(): string {
    return JSON.stringify(this);
  }
}
