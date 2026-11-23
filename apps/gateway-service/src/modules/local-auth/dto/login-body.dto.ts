import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

/**
 * The password is checked for type and size only: global-management decides
 * the policy (PASSWORD_POLICY, 12 to 128 code points).
 */
export class LoginBodyDto {
  @ApiProperty({ example: 'admin@example.test', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password', minLength: 1, maxLength: 1024 })
  @IsString()
  @Length(1, 1024)
  password: string;
}
