import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class OrganizationAddMemberResponseDto {
  @ApiProperty({
    description: 'Message describing the outcome',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  @ApiProperty({
    description: 'Unique identifier of the user',
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
