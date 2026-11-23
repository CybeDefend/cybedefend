// src/global-management/team/response/team-informations-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty, IsDateString } from 'class-validator';

export class TeamInformationsResponseDto {
  @ApiProperty({ description: 'Team unique identifier', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  readonly id: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly name: string;

  @ApiProperty({ description: 'Team description', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly description: string;

  @ApiProperty({ description: 'Team creation date', format: 'date-time' })
  @IsNotEmpty()
  @IsDateString()
  readonly createdAt: Date;

  @ApiProperty({ description: 'Team update date', format: 'date-time' })
  @IsNotEmpty()
  @IsDateString()
  readonly updatedAt: Date;

  constructor(
    id: string,
    name: string,
    description: string,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public toString(): string {
    return JSON.stringify({
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }
}
