import { ApiProperty } from '@nestjs/swagger';

export class VersionResponseDto {
  @ApiProperty({
    description: 'The service name',
    example: 'Gateway Service',
  })
  service: string;

  @ApiProperty({
    description: 'The current service version',
    example: '0.3.0',
  })
  version: string;

  @ApiProperty({
    description: 'The git commit hash',
    example: 'abc1234',
  })
  commit: string;

  @ApiProperty({
    description: 'The current Node environment',
    example: 'production',
    enum: ['development', 'staging', 'production'],
  })
  environment: string;

  @ApiProperty({
    description: 'The deployment environment',
    example: 'production',
  })
  deploymentEnv: string;
}
