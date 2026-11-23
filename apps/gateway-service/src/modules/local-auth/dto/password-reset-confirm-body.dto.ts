import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';

/**
 * POST /auth/password-reset/confirm: the one-time link token (base64url,
 * 32 bytes = 43 characters) and the new password. The policy (12 to 128
 * code points) is global-management's (PASSWORD_POLICY).
 */
export class PasswordResetConfirmBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 512 })
  @IsString()
  @Length(1, 512)
  token: string;

  @ApiProperty({
    format: 'password',
    maxLength: 1024,
    description: 'The policy (12 to 128 characters) is global-management’s',
  })
  @IsString()
  @MaxLength(1024)
  newPassword: string;
}
