// src/global-management/project/response/paginated-projects-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber } from 'class-validator';
import { ProjectInformationsResponseDto } from './project-informations-response.dto';

export class PaginatedProjectsResponseDto {
  @ApiProperty({
    description: 'List of projects',
    isArray: true,
    type: () => [ProjectInformationsResponseDto],
  })
  @IsArray()
  projects: ProjectInformationsResponseDto[];

  @ApiProperty({ description: 'Total number of projects', type: 'number' })
  @IsNumber()
  totalProjects: number;

  @ApiProperty({ description: 'Total number of pages', type: 'number' })
  @IsNumber()
  totalPages: number;

  constructor(
    projects: ProjectInformationsResponseDto[],
    totalProjects: number,
    totalPages: number,
  ) {
    this.projects = projects;
    this.totalProjects = totalProjects;
    this.totalPages = totalPages;
  }

  public toString(): string {
    return JSON.stringify({
      projects: this.projects,
      totalProjects: this.totalProjects,
      totalPages: this.totalPages,
    });
  }
}
