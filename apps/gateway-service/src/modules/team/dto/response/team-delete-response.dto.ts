// src/global-management/team/response/team-delete-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class TeamDeleteResponseDto {
  @ApiProperty({
    description: 'Message describing the result of deletion',
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
