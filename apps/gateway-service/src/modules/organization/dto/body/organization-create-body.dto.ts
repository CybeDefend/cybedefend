import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  Length,
  IsISO31661Alpha2,
  IsIn,
  IsOptional,
} from 'class-validator';

/**
 * The body of POST /organization: the organisation itself. A closed
 * extension declares its own sign-up fields on this class and maps them
 * (organization-create-fields.ts); without one, any other field is stripped
 * by the global validation pipe.
 */
export class OrganizationCreateBodyDto {
  @ApiProperty({
    description: 'Organization name',
    required: true,
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  readonly name: string;

  // Optional, validated when supplied.
  @ApiPropertyOptional({
    description: 'Industry sector of the organization (select)',
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
      'freelance',
      'other',
    ],
  })
  @IsOptional()
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
    'freelance',
    'other',
  ])
  readonly industry?: string;

  @ApiPropertyOptional({
    description: 'Country code (ISO 3166-1 alpha-2)',
    type: 'string',
  })
  @IsOptional()
  @IsString()
  @IsISO31661Alpha2()
  readonly country?: string;

  constructor(name: string, industry?: string, country?: string) {
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
