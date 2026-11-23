import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class UserInformationsResponseDto {
  @ApiProperty({
    description: 'User unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  readonly id: string;

  @ApiProperty({ description: 'User first name', type: 'string' })
  @IsString()
  readonly firstName: string;

  @ApiProperty({ description: 'User last name', type: 'string' })
  @IsString()
  readonly lastName: string;

  @ApiProperty({
    description: 'User email address',
    type: 'string',
    format: 'email',
  })
  @IsEmail()
  readonly email: string;

  @ApiProperty({ description: 'User picture URL', type: 'string' })
  @IsString()
  readonly picture: string;

  @ApiProperty({ description: 'User role in the organization', type: 'string' })
  @IsString()
  @IsOptional()
  readonly role: string;

  constructor(
    id: string,
    firstName: string,
    lastName: string,
    email: string,
    picture: string,
    role?: string,
  ) {
    this.id = id;
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.picture = picture;
    this.role = role;
  }

  public toString(): string {
    return JSON.stringify({
      id: this.id,
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      picture: this.picture,
      role: this.role,
    });
  }
}
