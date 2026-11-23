import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * POST /auth/password-reset/request. The route answers 202 for any e-mail,
 * known or not: the answer must not reveal whether the account exists.
 */
export class PasswordResetRequestBodyDto {
  @ApiProperty({ example: 'admin@example.test', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;
}
