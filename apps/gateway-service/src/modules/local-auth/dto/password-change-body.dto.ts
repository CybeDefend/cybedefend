import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';

/**
 * POST /auth/password/change. Both passwords are checked for type and
 * size only: the policy (12 to 128 code points) is global-management's
 * (PASSWORD_POLICY). CURRENT_PASSWORD_INVALID is its answer too, never 401.
 */
export class PasswordChangeBodyDto {
  @ApiProperty({ format: 'password', minLength: 1, maxLength: 1024 })
  @IsString()
  @Length(1, 1024)
  currentPassword: string;

  @ApiProperty({
    format: 'password',
    maxLength: 1024,
    description: 'The policy (12 to 128 characters) is global-management’s',
  })
  @IsString()
  @MaxLength(1024)
  newPassword: string;
}
