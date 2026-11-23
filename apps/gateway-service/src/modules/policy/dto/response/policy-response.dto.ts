import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PolicyResponseDto {
  @ApiProperty({
    description: 'Policy ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'Policy scope',
    enum: ['ORGANIZATION', 'TEAM', 'PROJECT'],
    example: 'PROJECT',
  })
  scope: string;

  @ApiProperty({
    description: 'Organization ID the policy belongs to',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  organizationId: string;

  @ApiPropertyOptional({
    description: 'Project IDs targeted by this policy (for PROJECT scope)',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440002'],
  })
  projectIds?: string[];

  @ApiPropertyOptional({
    description: 'Team IDs targeted by this policy (for TEAM scope)',
    type: [String],
    example: ['550e8400-e29b-41d4-a716-446655440003'],
  })
  teamIds?: string[];

  @ApiProperty({
    description: 'Policy name',
    example: 'Production Security Policy',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Policy description',
    example: 'Security policy for production environment',
  })
  description?: string;

  @ApiProperty({
    description: 'Priority (lower = higher priority)',
    example: 10,
  })
  priority: number;

  @ApiProperty({
    description: 'Policy configuration',
    example: {
      rules: [],
      exclusions: [],
    },
  })
  config: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether the policy is enabled',
    example: true,
  })
  isEnabled: boolean;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  updatedAt: string;

  @ApiPropertyOptional({
    description: 'User ID who created the policy',
  })
  createdBy?: string;

  @ApiPropertyOptional({
    description: 'User ID who last updated the policy',
  })
  updatedBy?: string;
}

export class PolicyListResponseDto {
  @ApiProperty({
    description: 'List of policies',
    type: [PolicyResponseDto],
  })
  policies: PolicyResponseDto[];

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
    example: 20,
  })
  pageSize: number;
}

export class DeletePolicyResponseDto {
  @ApiProperty({
    description: 'Whether the deletion was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Message',
    example: 'Policy deleted successfully',
  })
  message: string;
}

export class EffectivePolicyResponseDto {
  @ApiProperty({
    description: 'Effective merged policy configuration',
    example: {
      rules: [],
      exclusions: [],
      notifications: [],
    },
  })
  effectiveConfig: Record<string, unknown>;

  @ApiProperty({
    description: 'Applied policies (ordered by priority)',
    type: [PolicyResponseDto],
  })
  appliedPolicies: PolicyResponseDto[];
}

export class ValidatePolicyResponseDto {
  @ApiProperty({
    description: 'Whether the policy is valid',
    example: true,
  })
  valid: boolean;

  @ApiProperty({
    description: 'List of validation errors',
    type: [String],
    example: [],
  })
  errors: string[];

  @ApiProperty({
    description: 'List of warnings',
    type: [String],
    example: [],
  })
  warnings: string[];
}
