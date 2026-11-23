import { ApiProperty } from '@nestjs/swagger';

export class SetupStatusResponseDto {
  @ApiProperty({ description: 'True while the instance has no user' })
  setupOpen: boolean;

  @ApiProperty({ enum: ['invite_only', 'open'] })
  signupMode: string;

  @ApiProperty({ description: 'True when the instance can send e-mail' })
  passwordResetByEmail: boolean;
}
