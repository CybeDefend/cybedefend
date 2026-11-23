// src/global-management/project/response/project-update-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ProjectInformationsResponseDto } from './project-informations-response.dto';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class ProjectUpdateResponseDto {
  @ApiProperty({
    description: 'Indicates if the update was successful',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly success: boolean;

  @ApiProperty({
    description: 'Message describing the result of the update',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  @ApiProperty({
    description: 'Updated project informations',
    type: () => ProjectInformationsResponseDto,
  })
  readonly projectInformations: ProjectInformationsResponseDto;

  constructor(
    success: boolean,
    message: string,
    projectInformations: ProjectInformationsResponseDto,
  ) {
    this.success = success;
    this.message = message;
    this.projectInformations = projectInformations;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
