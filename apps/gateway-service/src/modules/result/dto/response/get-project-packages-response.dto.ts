// src/global-management/vulnerability/response/sca-detected-package.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';

export class ScaDetectedPackageDto {
  @ApiProperty({
    description: 'Unique identifier of the detected package',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Project unique identifier', type: 'string' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: 'Name of the package', type: 'string' })
  @IsString()
  @IsNotEmpty()
  packageName: string;

  @ApiProperty({ description: 'Version of the package', type: 'string' })
  @IsString()
  @IsNotEmpty()
  packageVersion: string;

  @ApiProperty({
    description: 'File name where the package was detected',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ description: 'Ecosystem (npm, maven, etc.)', type: 'string' })
  @IsString()
  @IsNotEmpty()
  ecosystem: string;

  @ApiProperty({
    description: 'Date when the record was created',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  createdAt: string;

  @ApiProperty({
    description: 'Date when the record was updated',
    type: 'string',
  })
  @IsString()
  @IsNotEmpty()
  updatedAt: string;

  constructor(
    id: string,
    projectId: string,
    packageName: string,
    packageVersion: string,
    fileName: string,
    ecosystem: string,
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.projectId = projectId;
    this.packageName = packageName;
    this.packageVersion = packageVersion;
    this.fileName = fileName;
    this.ecosystem = ecosystem;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}

export class GetProjectPackagesResponseDto {
  @ApiProperty({ description: 'Project unique identifier', type: 'string' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: 'Current page number', type: 'number' })
  @IsInt()
  @Min(1)
  page: number;

  @ApiProperty({ description: 'Number of items per page', type: 'number' })
  @IsInt()
  @Min(1)
  limit: number;

  @ApiProperty({ description: 'Total number of packages', type: 'number' })
  @IsInt()
  @Min(0)
  total: number;

  @ApiProperty({ description: 'Total number of pages', type: 'number' })
  @IsInt()
  @Min(0)
  totalPages: number;

  @ApiProperty({
    description: 'List of packages detected',
    isArray: true,
    type: () => [ScaDetectedPackageDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  packages: ScaDetectedPackageDto[];

  constructor(
    projectId: string,
    page: number,
    limit: number,
    total: number,
    totalPages: number,
    packages: ScaDetectedPackageDto[],
  ) {
    this.projectId = projectId;
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = totalPages;
    this.packages = packages;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
