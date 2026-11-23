import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class OrganizationUpdateResponseDto {
  @ApiProperty({
    description: 'Message describing the outcome',
    type: 'string',
  })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  constructor(success: boolean, message: string) {
    this.message = message;
  }

  public toString(): string {
    return JSON.stringify({
      message: this.message,
    });
  }
}
