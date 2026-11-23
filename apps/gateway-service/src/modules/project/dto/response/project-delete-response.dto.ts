// src/global-management/project/response/project-delete-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ProjectDeleteResponseDto {
  @ApiProperty({
    description: 'Message describing the result of project deletion',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  constructor(message: string) {
    this.message = message;
  }

  public toString(): string {
    return JSON.stringify({
      message: this.message,
    });
  }
}
