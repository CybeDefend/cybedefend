import { IsIn, IsNotEmpty, IsString, Length } from 'class-validator';

export class PermissionCheckRequestDto {
  constructor(
    resourceId: string,
    resourceType: string,
    permission: string,
    subjectId: string,
    subjectType: string,
  ) {
    this.resourceId = resourceId;
    this.resourceType = resourceType;
    this.permission = permission;
    this.subjectId = subjectId;
    this.subjectType = subjectType;
  }

  // Identifier of the resource to check permission for
  @IsNotEmpty()
  @Length(1, 1023)
  readonly resourceId: string;

  // Type of the resource to check permission for
  @IsString()
  @Length(0, 255)
  @IsIn(['organization', 'project', 'team'])
  readonly resourceType: string;

  // Permission to check
  @IsString()
  @Length(0, 255)
  readonly permission: string;

  // Type of the subject to check permission for
  @IsString()
  @Length(0, 255)
  @IsIn(['user', 'group', 'role'])
  readonly subjectType: string;

  // Identifier of the subject to check permission for (fluently, the user)
  @IsString()
  @Length(0, 1023)
  readonly subjectId: string;

  public toString(): string {
    return JSON.stringify({
      resourceId: this.resourceId,
      resourceType: this.resourceType,
      permission: this.permission,
      subjectType: this.subjectType,
      subjectId: this.subjectId,
    });
  }
}
