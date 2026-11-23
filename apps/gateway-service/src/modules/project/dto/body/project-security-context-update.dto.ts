import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ProjectSecurityContextUpdateDto {
  @ApiProperty({
    description: 'Deployment environment of the project',
    required: false,
    enum: ['production', 'staging', 'development'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['production', 'staging', 'development'])
  readonly environment?: string;

  @ApiProperty({
    description: 'Internet exposure level',
    required: false,
    enum: ['public', 'internal', 'airgapped'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['public', 'internal', 'airgapped'])
  readonly internetExposure?: string;

  @ApiProperty({
    description: 'Deployment type',
    required: false,
    enum: ['saas', 'onprem', 'embedded', 'mobile'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['saas', 'onprem', 'embedded', 'mobile'])
  readonly deploymentType?: string;

  @ApiProperty({
    description: 'Data classification level',
    required: false,
    enum: ['public', 'internal', 'confidential', 'regulated'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['public', 'internal', 'confidential', 'regulated'])
  readonly dataClassification?: string;

  @ApiProperty({
    description: 'Whether the project handles PII data',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly handlesPii?: boolean;

  @ApiProperty({
    description: 'Whether the project handles payment data',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly handlesPaymentData?: boolean;

  @ApiProperty({
    description: 'Business criticality level',
    required: false,
    enum: ['low', 'medium', 'high', 'mission_critical'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high', 'mission_critical'])
  readonly businessCriticality?: string;

  @ApiProperty({
    description: 'User base size',
    required: false,
    enum: ['small', 'medium', 'large'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['small', 'medium', 'large'])
  readonly userBaseSize?: string;

  @ApiProperty({
    description: 'Compliance frameworks the project must adhere to',
    required: false,
    isArray: true,
    type: 'string',
    example: ['SOC2', 'GDPR', 'HIPAA'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  @IsIn(['SOC2', 'HIPAA', 'PCI_DSS', 'GDPR', 'ISO27001'], { each: true })
  readonly complianceFrameworks?: string[];

  @ApiProperty({
    description: 'Whether the project is safety-critical',
    required: false,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  readonly safetyCritical?: boolean;

  @ApiProperty({
    description: 'Network segmentation level',
    required: false,
    enum: ['flat', 'segmented', 'microsegmented'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['flat', 'segmented', 'microsegmented'])
  readonly networkSegmentation?: string;

  constructor(data: Partial<ProjectSecurityContextUpdateDto>) {
    Object.assign(this, data);
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
