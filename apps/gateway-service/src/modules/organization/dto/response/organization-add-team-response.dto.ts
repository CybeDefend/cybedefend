import { IsBoolean, IsString } from 'class-validator';

export class OrganizationAddTeamResponseDto {
  @IsBoolean()
  readonly success: boolean;

  @IsString()
  readonly message: string;

  constructor(success: boolean, message: string) {
    this.success = success;
    this.message = message;
  }

  public toString(): string {
    return JSON.stringify({
      success: this.success,
      message: this.message,
    });
  }
}
