import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class OrganizationGetIdByProjectIdResponseDto {
  @ApiProperty({
    description: 'Organization unique identifier',
    type: 'string',
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  organizationId: string;

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
