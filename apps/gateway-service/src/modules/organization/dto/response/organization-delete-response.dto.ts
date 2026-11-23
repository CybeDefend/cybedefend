import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class OrganizationDeleteResponseDto {
  @ApiProperty({
    description: 'Message describing the outcome',
    type: 'string',
  })
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
