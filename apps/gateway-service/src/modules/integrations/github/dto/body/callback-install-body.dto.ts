// src/github-service/body/callback-install-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Matches } from 'class-validator';
export class CallbackInstallBodyDto {
  @ApiProperty({ description: 'Authorization code returned by GitHub OAuth' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Installation ID from GitHub', example: 123456 })
  @IsNumber()
  @IsNotEmpty()
  installationId: number;

  @ApiProperty({
    description:
      'Installation state issued by POST /organization/:organizationId/github/install/state, single use, valid 10 minutes',
    example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    pattern: '^[a-f0-9]{64}$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  state: string;

  constructor(code: string, installationId: number, state: string) {
    this.code = code;
    this.installationId = installationId;
    this.state = state;
  }
  public toString(): string {
    // The state is a single-use secret: never print it.
    return JSON.stringify({
      code: this.code,
      installationId: this.installationId,
    });
  }
}
