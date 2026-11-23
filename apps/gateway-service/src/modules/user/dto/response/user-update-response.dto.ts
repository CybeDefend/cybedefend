// src/global-management/user/response/user-update-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class UserUpdateResponseDto {
  @ApiProperty({ description: 'Result message', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  @ApiProperty({
    description: 'User unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsNotEmpty()
  @IsUUID()
  readonly userId: string;

  constructor(message: string, userId: string) {
    this.message = message;
    this.userId = userId;
  }

  public toString(): string {
    return JSON.stringify({
      message: this.message,
      userId: this.userId,
    });
  }
}
