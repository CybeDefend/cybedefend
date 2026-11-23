import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  Result,
  ContainerPackage,
  ContainerVulnerability,
  CVSSInfo,
} from '@grpc/analysis-reporting/result';

// --- DTO definitions validating the HTTP request body ---

class ContainerPackageDto {
  @ApiProperty() @IsString() id: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsString() version: string;
  @ApiProperty() @IsString() arch: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() srcName?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  srcVersion?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() digest?: string;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  licenses?: string[];
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  dependsOn?: string[];
  @ApiProperty({
    required: false,
    description:
      'Complete distribution version `[epoch:]version[-release]`. ' +
      'Required for OSV matching of deb/rpm packages.',
  })
  @IsOptional()
  @IsString()
  fullVersion?: string;
  @ApiProperty({
    required: false,
    description: 'Complete version of the source package.',
  })
  @IsOptional()
  @IsString()
  srcFullVersion?: string;
}

class CVSSInfoDTO {
  @ApiProperty({ required: false }) @IsOptional() @IsString() v2Vector?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() v3Vector?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() v4Vector?: string;
  @ApiProperty({ required: false }) @IsOptional() v2Score?: number;
  @ApiProperty({ required: false }) @IsOptional() v3Score?: number;
  @ApiProperty({ required: false }) @IsOptional() v4Score?: number;
}

class DataSourceDTO {
  @ApiProperty({ required: false }) @IsOptional() @IsString() id?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() url?: string;
}

class ContainerVulnerabilityDto {
  @ApiProperty() @IsString() vulnerabilityId: string;
  @ApiProperty() @IsString() pkgName: string;
  @ApiProperty() @IsString() installedVersion: string;
  @ApiProperty() @IsString() fixedVersion: string;
  @ApiProperty() @IsString() severity: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() title?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  primaryUrl?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  publishedDate?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  lastModifiedDate?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  layerDigest?: string;
  @ApiProperty() @IsString() target: string;
  @ApiProperty() @IsString() class: string;
  @ApiProperty() @IsString() type: string;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  cweIds?: string[];
  @ApiProperty({ type: DataSourceDTO, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => DataSourceDTO)
  dataSource?: DataSourceDTO;
  @IsOptional()
  cvss?: Record<string, CVSSInfoDTO>;
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  references?: string[];
}

class ResultDto {
  @ApiProperty() @IsString() target: string;
  @ApiProperty() @IsString() class: string;
  @ApiProperty() @IsString() type: string;
  @ValidateNested({ each: true })
  @Type(() => ContainerPackageDto)
  @ApiProperty({ type: [ContainerPackageDto], required: false })
  @IsOptional()
  @IsArray()
  packages?: ContainerPackageDto[];
  @ValidateNested({ each: true })
  @Type(() => ContainerVulnerabilityDto)
  @ApiProperty({ type: [ContainerVulnerabilityDto], required: false })
  @IsOptional()
  @IsArray()
  vulnerabilities?: ContainerVulnerabilityDto[];
}

class ContainerOSDto {
  @ApiProperty() @IsString() family: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsBoolean() eosl: boolean;
}

class ChunkInfoDto {
  @ApiProperty() @IsInt() @Min(1) index: number;
  @ApiProperty() @IsBoolean() isLast: boolean;
}

export class ScanAddContainerResultBodyDto {
  @ApiProperty() @IsString() scanId: string;
  @ApiProperty() @IsString() scannerName: string;
  @ApiProperty() @IsISO8601() startedAt: string;
  @ApiProperty() @IsISO8601() finishedAt: string;
  @ValidateNested()
  @Type(() => ChunkInfoDto)
  @ApiProperty({ type: ChunkInfoDto })
  chunk: ChunkInfoDto;
  @ValidateNested()
  @Type(() => ContainerOSDto)
  @ApiProperty({ type: ContainerOSDto })
  os: ContainerOSDto;
  @ValidateNested({ each: true })
  @Type(() => ResultDto)
  @ApiProperty({ type: [ResultDto], required: false })
  @IsOptional()
  @IsArray()
  results?: ResultDto[];
  @ApiProperty({
    required: false,
    description:
      'Full image name (e.g., registry.gitlab.com/group/project:tag)',
  })
  @IsOptional()
  @IsString()
  imageName?: string;
}

// --- Exported mapping functions ---

function mapPackage(dto: ContainerPackageDto): ContainerPackage {
  return {
    id: dto.id,
    name: dto.name,
    version: dto.version,
    arch: dto.arch,
    srcName: dto.srcName ?? '',
    srcVersion: dto.srcVersion ?? '',
    digest: dto.digest ?? '',
    licenses: dto.licenses ?? [],
    dependsOn: dto.dependsOn ?? [],
    // Complete distribution version, empty until the scanner sends it.
    fullVersion: dto.fullVersion ?? '',
    srcFullVersion: dto.srcFullVersion ?? '',
  };
}

function mapVulnerability(
  dto: ContainerVulnerabilityDto,
): ContainerVulnerability {
  const mappedCvss: { [key: string]: CVSSInfo } = {};
  if (dto.cvss) {
    for (const key in dto.cvss) {
      const cvssDto = dto.cvss[key];
      mappedCvss[key] = {
        v2Vector: cvssDto.v2Vector ?? '',
        v3Vector: cvssDto.v3Vector ?? '',
        v2Score: cvssDto.v2Score ?? 0,
        v3Score: cvssDto.v3Score ?? 0,
      };
    }
  }

  return {
    vulnerabilityId: dto.vulnerabilityId,
    pkgName: dto.pkgName,
    installedVersion: dto.installedVersion,
    fixedVersion: dto.fixedVersion,
    severity: dto.severity,
    title: dto.title ?? '',
    description: dto.description ?? '',
    primaryUrl: dto.primaryUrl ?? '',
    publishedDate: dto.publishedDate ?? '',
    lastModifiedDate: dto.lastModifiedDate ?? '',
    layerDigest: dto.layerDigest ?? '',
    target: dto.target,
    class: dto.class,
    type: dto.type,
    cweIds: dto.cweIds ?? [],
    internalId: '',
    dataSource: {
      id: dto.dataSource?.id ?? '',
      name: dto.dataSource?.name ?? '',
      url: dto.dataSource?.url ?? '',
    },
    cvss: mappedCvss,
    references: dto.references ?? [],
  };
}

export function mapResult(dto: ResultDto): Result {
  return {
    target: dto.target,
    class: dto.class,
    type: dto.type,
    packages: (dto.packages || []).map(mapPackage),
    vulnerabilities: (dto.vulnerabilities || []).map(mapVulnerability),
  };
}
