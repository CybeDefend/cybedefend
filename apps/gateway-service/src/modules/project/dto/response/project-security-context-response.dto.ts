import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ProjectSecurityContext } from '@grpc/global-management/project';

/**
 * Robust enum resolver: handles numeric proto values, string enum names, and passthrough strings.
 * This ensures the DTO always returns clean lowercase string values regardless of what gRPC sends.
 */
function resolveEnum(
  value: unknown,
  validValues: string[],
  fallback: string,
): string {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    // Direct match (e.g., "production")
    if (validValues.includes(lower)) return lower;
    // Proto enum name (e.g., "PROJECT_ENVIRONMENT_PRODUCTION" → extract last part)
    const parts = lower.split('_');
    const last = parts[parts.length - 1];
    if (validValues.includes(last)) return last;
    // Try joining last parts for multi-word values like "mission_critical"
    for (let i = parts.length - 2; i >= 0; i--) {
      const candidate = parts.slice(i).join('_');
      if (validValues.includes(candidate)) return candidate;
    }
  }
  if (typeof value === 'number') {
    // Numeric proto enum: index into valid values (0 = unspecified, 1+ = actual values)
    if (value > 0 && value <= validValues.length) return validValues[value - 1];
  }
  return fallback;
}

const ENVIRONMENTS = ['production', 'staging', 'development'];
const EXPOSURES = ['public', 'internal', 'airgapped'];
const DEPLOYMENT_TYPES = ['saas', 'onprem', 'embedded', 'mobile'];
const DATA_CLASSIFICATIONS = [
  'public',
  'internal',
  'confidential',
  'regulated',
];
const CRITICALITIES = ['low', 'medium', 'high', 'mission_critical'];
const USER_BASE_SIZES = ['small', 'medium', 'large'];
const NETWORK_SEGMENTATIONS = ['flat', 'segmented', 'microsegmented'];

export class ProjectSecurityContextResponseDto {
  @ApiProperty({
    description: 'Security context unique identifier',
    format: 'uuid',
  })
  @IsNotEmpty()
  @IsUUID()
  readonly id: string;

  @ApiProperty({ description: 'Project unique identifier', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  readonly projectId: string;

  @ApiProperty({
    description: 'Deployment environment',
    enum: ['unspecified', 'production', 'staging', 'development'],
  })
  @IsNotEmpty()
  @IsString()
  readonly environment: string;

  @ApiProperty({
    description: 'Internet exposure level',
    enum: ['unspecified', 'public', 'internal', 'airgapped'],
  })
  @IsNotEmpty()
  @IsString()
  readonly internetExposure: string;

  @ApiProperty({
    description: 'Deployment type',
    enum: ['unspecified', 'saas', 'onprem', 'embedded', 'mobile'],
  })
  @IsNotEmpty()
  @IsString()
  readonly deploymentType: string;

  @ApiProperty({
    description: 'Data classification level',
    enum: ['unspecified', 'public', 'internal', 'confidential', 'regulated'],
  })
  @IsNotEmpty()
  @IsString()
  readonly dataClassification: string;

  @ApiProperty({
    description: 'Whether the project handles PII data',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly handlesPii: boolean;

  @ApiProperty({
    description: 'Whether the project handles payment data',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly handlesPaymentData: boolean;

  @ApiProperty({
    description: 'Business criticality level',
    enum: ['unspecified', 'low', 'medium', 'high', 'mission_critical'],
  })
  @IsNotEmpty()
  @IsString()
  readonly businessCriticality: string;

  @ApiProperty({
    description: 'User base size',
    enum: ['unspecified', 'small', 'medium', 'large'],
  })
  @IsNotEmpty()
  @IsString()
  readonly userBaseSize: string;

  @ApiProperty({
    description: 'Compliance frameworks',
    isArray: true,
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  readonly complianceFrameworks: string[];

  @ApiProperty({
    description: 'Whether the project is safety-critical',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly safetyCritical: boolean;

  @ApiProperty({
    description: 'Network segmentation level',
    enum: ['unspecified', 'flat', 'segmented', 'microsegmented'],
  })
  @IsNotEmpty()
  @IsString()
  readonly networkSegmentation: string;

  @ApiProperty({
    description: 'Whether the context has been customized',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly isCustomized: boolean;

  @ApiProperty({ description: 'Creation date', format: 'date-time' })
  @IsOptional()
  @IsString()
  readonly createdAt: string;

  @ApiProperty({ description: 'Last update date', format: 'date-time' })
  @IsOptional()
  @IsString()
  readonly updatedAt: string;

  constructor(ctx: ProjectSecurityContext) {
    this.id = ctx.id;
    this.projectId = ctx.projectId;
    this.environment = resolveEnum(ctx.environment, ENVIRONMENTS, 'production');
    this.internetExposure = resolveEnum(
      ctx.internetExposure,
      EXPOSURES,
      'public',
    );
    this.deploymentType = resolveEnum(
      ctx.deploymentType,
      DEPLOYMENT_TYPES,
      'saas',
    );
    this.dataClassification = resolveEnum(
      ctx.dataClassification,
      DATA_CLASSIFICATIONS,
      'confidential',
    );
    this.handlesPii = ctx.handlesPii ?? false;
    this.handlesPaymentData = ctx.handlesPaymentData ?? false;
    this.businessCriticality = resolveEnum(
      ctx.businessCriticality,
      CRITICALITIES,
      'medium',
    );
    this.userBaseSize = resolveEnum(
      ctx.userBaseSize,
      USER_BASE_SIZES,
      'medium',
    );
    this.complianceFrameworks = ctx.complianceFrameworks ?? [];
    this.safetyCritical = ctx.safetyCritical ?? false;
    this.networkSegmentation = resolveEnum(
      ctx.networkSegmentation,
      NETWORK_SEGMENTATIONS,
      'flat',
    );
    this.isCustomized = ctx.isCustomized ?? false;
    this.createdAt = ctx.createdAt;
    this.updatedAt = ctx.updatedAt;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
