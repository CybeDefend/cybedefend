import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

/** An open sign-up (AUTH_SIGNUP_MODE=open). */
export class SignupBodyDto {
  @ApiProperty({ example: 'dev@example.test', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Grace Hopper', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({
    format: 'password',
    maxLength: 1024,
    description: 'The policy (12 to 128 characters) is global-management’s',
  })
  @IsString()
  @MaxLength(1024)
  password: string;
}
