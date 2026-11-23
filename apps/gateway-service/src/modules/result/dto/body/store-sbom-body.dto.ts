import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsJSON,
  ValidateIf,
} from 'class-validator';

export class StoreSbomBodyDto {
  @ApiProperty({
    description: 'The complete SBOM JSON report as a string',
    example: '{"bomFormat":"CycloneDX","specVersion":"1.4",...}',
    required: false,
  })
  @ValidateIf((o) => !o.sbomZip)
  @IsString()
  @IsNotEmpty()
  @IsJSON()
  sbomJson?: string;

  @ApiProperty({
    description:
      'The SBOM JSON report compressed with zlib deflate and encoded in base64',
    example: 'eJzLSM3JyVcozy/KSVHITP...',
    required: false,
  })
  @ValidateIf((o) => !o.sbomJson)
  @IsString()
  @IsNotEmpty()
  sbomZip?: string;

  @ApiProperty({
    description: 'SBOM format (e.g., cyclonedx, spdx, syft-json, custom)',
    example: 'cyclonedx',
    required: false,
  })
  @IsString()
  @IsOptional()
  format?: string;

  @ApiProperty({
    description: 'SBOM format version (e.g., 1.4, 2.3)',
    example: '1.4',
    required: false,
  })
  @IsString()
  @IsOptional()
  version?: string;
}
