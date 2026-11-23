import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsIn, Length } from 'class-validator';
import { ASSIGNABLE_ORGANIZATION_ROLES } from '../../organization-roles';

export class OrganizationAddMemberBodyDto {
  @ApiProperty({
    description: 'Member email address',
    required: true,
    type: 'string',
  })
  @IsString()
  @Length(1, 255)
  @IsNotEmpty()
  readonly email: string;

  @ApiProperty({
    description: 'Role to assign to the member',
    enum: ASSIGNABLE_ORGANIZATION_ROLES,
  })
  @IsString()
  @Length(0, 255)
  @IsIn(ASSIGNABLE_ORGANIZATION_ROLES)
  readonly role: string;

  constructor(email: string, role: string) {
    this.email = email;
    this.role = role;
  }

  public toString(): string {
    return JSON.stringify({
      email: this.email,
      role: this.role,
    });
  }
}
