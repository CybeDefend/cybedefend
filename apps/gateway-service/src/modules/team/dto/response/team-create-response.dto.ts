// src/global-management/team/response/team-create-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, Length } from 'class-validator';

export class TeamCreateResponseDto {
  @ApiProperty({
    description: 'Indicates if creation was successful',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly success: boolean;

  @ApiProperty({ description: 'Result message', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  @ApiProperty({ description: 'Organization identifier', type: 'string' })
  @IsString()
  @Length(0, 255)
  readonly organizationId: string;

  @ApiProperty({ description: 'Team identifier', type: 'string' })
  @IsString()
  @Length(0, 255)
  readonly teamId: string;

  @ApiProperty({ description: 'Team name', type: 'string' })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  readonly name: string;

  @ApiProperty({ description: 'Team description', type: 'string' })
  @IsNotEmpty()
  @IsString()
  @Length(1, 1024)
  readonly description: string;

  constructor(
    success: boolean,
    message: string,
    organizationId: string,
    teamId: string,
    name: string,
    description: string,
  ) {
    this.success = success;
    this.message = message;
    this.organizationId = organizationId;
    this.teamId = teamId;
    this.name = name;
    this.description = description;
  }

  public toString(): string {
    return JSON.stringify({
      success: this.success,
      message: this.message,
      organizationId: this.organizationId,
      teamId: this.teamId,
      name: this.name,
      description: this.description,
    });
  }
}
