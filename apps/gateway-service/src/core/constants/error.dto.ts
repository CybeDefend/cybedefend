import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsISO8601,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class ErrorDto {
  @ApiProperty({
    example: '2025-02-18T12:31:18.491Z',
    description: 'Timestamp of the error',
  })
  @IsISO8601()
  @IsNotEmpty()
  timestamp: string;

  @ApiProperty({
    example: 'AiService',
    description: 'Name of the service where the error occurred',
  })
  @IsString()
  @IsNotEmpty()
  service: string;

  @ApiProperty({
    example: 'startConversation',
    description: 'Method name where the error occurred',
  })
  @IsString()
  @IsNotEmpty()
  method: string;

  @ApiProperty({
    example: 'Invalid parameters provided',
    description: 'Error message',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    example: 400,
    description: 'HTTP status code',
    minimum: 100,
    maximum: 599,
  })
  @IsNumber()
  @Min(100)
  @Max(599)
  @IsNotEmpty()
  code: number;

  constructor(service: string, method: string, message: string, code: number) {
    this.timestamp = new Date().toISOString();
    this.service = service;
    this.method = method;
    this.message = message;
    this.code = code;
  }

  toString(): string {
    return JSON.stringify(this);
  }
}
