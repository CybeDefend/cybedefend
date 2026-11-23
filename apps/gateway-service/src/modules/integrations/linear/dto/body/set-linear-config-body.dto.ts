import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SetLinearConfigBodyDto {
  @ApiProperty({
    description: 'Linear team ID',
    format: 'uuid',
    example: '8f14e45f-ceea-467a-9575-1ae4b1c3d2a1',
  })
  @IsUUID()
  teamId: string;

  @ApiPropertyOptional({
    description: 'Linear project ID tickets are attached to (optional)',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  linearProjectId?: string;

  @ApiPropertyOptional({
    description: 'Linear label IDs added to every ticket (20 at most)',
    type: [String],
  })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  labelIds?: string[];

  @ApiPropertyOptional({
    description:
      'Allowed branches for Linear ticket creation. Empty array = all branches allowed.',
    example: ['develop', 'main'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(50)
  @MaxLength(255, { each: true })
  allowedBranches?: string[];

  @ApiPropertyOptional({
    description: 'Whether to auto-create Linear tickets after scans',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  autoCreateEnabled?: boolean;
}
