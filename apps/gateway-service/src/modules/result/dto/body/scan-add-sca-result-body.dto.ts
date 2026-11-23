// src/global-management/vulnerability/body/scan-add-sca-result-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsUUID,
  IsString,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { LibraryDto } from './scan-add-result-request.dto';

export class ScanAddScaResultBodyDto {
  @ApiProperty({ description: 'Scan unique identifier', format: 'uuid' })
  @IsUUID()
  scanId: string;

  @ApiProperty({
    description: 'Scanner name (e.g. Snyk, OWASP)',
    type: 'string',
  })
  @IsString()
  scannerName: string;

  @ApiProperty({
    description: 'Indicates if this is the last SCA request',
    type: 'boolean',
  })
  @IsBoolean()
  isLastRequest: boolean;

  @ApiProperty({
    description: 'Type of vulnerability (usually sca)',
    type: 'string',
  })
  @IsString()
  vulnerabilityType: string;

  @ApiProperty({
    description: 'List of discovered packages or libraries',
    isArray: true,
    type: () => [LibraryDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LibraryDto)
  packages: LibraryDto[];

  constructor(
    scanId: string,
    scannerName: string,
    isLastRequest: boolean,
    vulnerabilityType: string,
    packages: LibraryDto[],
  ) {
    this.scanId = scanId;
    this.scannerName = scannerName;
    this.isLastRequest = isLastRequest;
    this.vulnerabilityType = vulnerabilityType;
    this.packages = packages;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
