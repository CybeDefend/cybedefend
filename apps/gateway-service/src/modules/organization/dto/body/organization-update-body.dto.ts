import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Length, IsIn } from 'class-validator';

export class OrganizationUpdateBodyDto {
  @ApiProperty({
    description: 'Organization name',
    required: true,
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  readonly name: string;

  @ApiProperty({
    description: 'Industry sector of the organization (select)',
    required: true,
    enum: [
      'software',
      'finance',
      'healthcare',
      'education',
      'manufacturing',
      'retail',
      'government',
      'energy',
      'telecom',
      'other',
    ],
  })
  @IsString()
  @IsIn([
    'software',
    'finance',
    'healthcare',
    'education',
    'manufacturing',
    'retail',
    'government',
    'energy',
    'telecom',
    'other',
  ])
  readonly industry: string;

  @ApiProperty({ description: 'Country', required: true, type: 'string' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  readonly country: string;

  constructor(name: string, industry: string, country: string) {
    this.name = name;
    this.industry = industry;
    this.country = country;
  }

  public toString(): string {
    return JSON.stringify({
      name: this.name,
      industry: this.industry,
      country: this.country,
    });
  }
}
