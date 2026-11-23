import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class OrganizationCreateResponseDto {
  @ApiProperty({ description: 'Creation status message', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  @ApiProperty({
    description: 'Unique identifier of the created organization',
    type: 'string',
    format: 'uuid',
  })
  @IsNotEmpty()
  @IsUUID()
  readonly organizationId: string;

  @ApiProperty({ description: 'Name of the organization', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly name: string;

  @ApiProperty({
    description: 'Description of the organization',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly description: string;

  @ApiProperty({
    description: 'Email address of the organization',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly email: string;

  constructor(
    message: string,
    organizationId: string,
    name: string,
    description: string,
    email: string,
  ) {
    this.message = message;
    this.organizationId = organizationId;
    this.name = name;
    this.description = description;
    this.email = email;
  }

  public toString(): string {
    return JSON.stringify({
      message: this.message,
      organizationId: this.organizationId,
      name: this.name,
      description: this.description,
      email: this.email,
    });
  }
}
