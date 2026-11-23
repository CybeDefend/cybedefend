import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsString, IsIn, Length } from 'class-validator';
import { ASSIGNABLE_ORGANIZATION_ROLES } from '../../organization-roles';

export class OrganizationUpdateRoleBodyDto {
  @ApiProperty({
    description: 'User unique identifier',
    required: true,
    format: 'uuid',
  })
  @IsUUID()
  @IsNotEmpty()
  @Length(0, 255)
  readonly userId: string;

  @ApiProperty({
    description: 'Role to assign',
    enum: ASSIGNABLE_ORGANIZATION_ROLES,
  })
  @IsString()
  @Length(0, 255)
  @IsIn(ASSIGNABLE_ORGANIZATION_ROLES)
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
