// src/global-management/scan/response/start-scan-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, IsArray, IsOptional } from 'class-validator';

export class StartScanResponseDto {
  @ApiProperty({
    description: 'Whether the scan started successfully',
    type: 'boolean',
  })
  @IsBoolean()
  success: boolean;

  @ApiProperty({
    description: 'Message describing the scan start result',
    type: 'string',
  })
  @IsString()
  message: string;

  @ApiProperty({
    description: 'The unique identifier of the created scan',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  scanId?: string;

  @ApiProperty({
    description: 'Detected languages (if any) during scan initialization',
    required: false,
    isArray: true,
    type: 'string',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  detectedLanguages?: string[];

  constructor(
    success: boolean,
    message: string,
    scanId?: string,
    detectedLanguages?: string[],
  ) {
    this.success = success;
    this.message = message;
    this.scanId = scanId;
    this.detectedLanguages = detectedLanguages;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
