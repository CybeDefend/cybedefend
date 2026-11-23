import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';

export class OrganizationDeleteMemberBodyDto {
  @ApiProperty({
    description: 'User unique identifier',
    required: true,
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  public toString(): string {
    return JSON.stringify({
      userId: this.userId,
    });
  }
}
