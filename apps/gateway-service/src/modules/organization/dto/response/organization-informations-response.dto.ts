import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class OrganizationInformationsResponseDto {
  @ApiProperty({
    description: 'Organization unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsNotEmpty()
  @IsUUID()
  readonly id: string;

  @ApiProperty({ description: 'Organization name', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly name: string;

  @ApiProperty({ description: 'Organization description', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly description: string;

  @ApiProperty({ description: 'Organization website', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly website: string;

  @ApiProperty({ description: 'Organization email', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly email: string;

  @ApiProperty({
    description: 'Organization concurrent scan limit',
    type: 'number',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  concurrentScanLimit: number;

  constructor(
    id: string,
    name: string,
    description: string,
    website: string,
    email: string,
    concurrentScanLimit?: number,
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.website = website;
    this.email = email;
    this.concurrentScanLimit = concurrentScanLimit;
  }

  public toString(): string {
    return JSON.stringify({
      id: this.id,
      name: this.name,
      description: this.description,
      website: this.website,
      email: this.email,
      concurrentScanLimit: this.concurrentScanLimit,
    });
  }
}
