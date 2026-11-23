import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

/** The first administrator and organisation of a Community instance. */
export class SetupBodyDto {
  @ApiProperty({
    description: 'The CYBEDEFEND_SETUP_TOKEN of the instance',
    minLength: 1,
    maxLength: 512,
  })
  @IsString()
  @Length(1, 512)
  setupToken: string;

  @ApiProperty({ example: 'admin@example.test', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Ada Lovelace', minLength: 1, maxLength: 100 })
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

  @ApiProperty({ example: 'Acme', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  organizationName: string;
}
