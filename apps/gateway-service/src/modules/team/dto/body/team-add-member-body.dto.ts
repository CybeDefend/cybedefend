// src/global-management/team/body/team-add-member-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsString, IsIn } from 'class-validator';

export class TeamAddMemberBodyDto {
  @ApiProperty({
    description: 'User unique identifier',
    required: true,
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  readonly userId: string;

  @ApiProperty({
    description: 'Role to assign to the member',
    enum: ['team_manager', 'analyst_developer', 'developer', 'read_only'],
  })
  @IsString()
  @IsIn(['team_manager', 'analyst_developer', 'developer', 'read_only'])
  readonly role: string;

  constructor(userId: string, role: string) {
    this.userId = userId;
    this.role = role;
  }

  public toString(): string {
    return JSON.stringify({
      userId: this.userId,
      role: this.role,
    });
  }
}
