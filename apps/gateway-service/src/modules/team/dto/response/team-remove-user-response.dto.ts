// src/global-management/team/response/team-remove-user-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class TeamRemoveUserResponseDto {
  @ApiProperty({
    description: 'Indicates if the removal was successful',
    type: 'boolean',
  })
  @IsNotEmpty()
  @IsBoolean()
  readonly success: boolean;

  @ApiProperty({
    description: 'Message describing the removal result',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  constructor(success: boolean, message: string) {
    this.success = success;
    this.message = message;
  }

  public toString(): string {
    return JSON.stringify({
      success: this.success,
      message: this.message,
    });
  }
}
