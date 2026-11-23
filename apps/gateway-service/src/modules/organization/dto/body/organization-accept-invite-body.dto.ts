import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class OrganizationAcceptInviteBodyDto {
  @ApiProperty({ description: 'Invite token', required: true, type: 'string' })
  @IsString()
  @IsNotEmpty()
  token: string;

  constructor(token: string) {
    this.token = token;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
