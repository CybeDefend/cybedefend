// src/global-management/team/body/team-remove-user-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty } from 'class-validator';

export class TeamRemoveUserBodyDto {
  @ApiProperty({ description: 'User unique identifier', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
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
