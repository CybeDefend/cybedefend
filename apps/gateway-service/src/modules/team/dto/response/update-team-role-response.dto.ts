// src/global-management/team/response/update-team-role-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';

export class UpdateTeamRoleResponseDto {
  @ApiProperty({
    description: 'Indicates if role update was successful',
    type: 'boolean',
  })
  @IsBoolean()
  readonly success: boolean;

  @ApiProperty({
    description: 'Message describing the update result',
    type: 'string',
  })
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
