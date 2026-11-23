// src/global-management/user/body/update-user-profile-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateUserProfileBodyDto {
  @ApiProperty({
    description: 'Enable or disable notifications for the user',
    required: false,
    type: 'boolean',
  })
  @IsBoolean()
  @IsOptional()
  readonly notification: boolean;

  @ApiProperty({
    description: 'Indicates whether onboarding is completed',
    required: false,
    type: 'boolean',
  })
  @IsBoolean()
  @IsOptional()
  readonly isOnboardingCompleted: boolean;

  @ApiProperty({
    description: 'JSON array of completed onboarding step IDs',
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  readonly onboardingProgress?: string;

  @ApiProperty({
    description: 'Onboarding persona selected by the user',
    required: false,
    enum: ['solo_dev', 'tech_lead', 'security_pro', 'unspecified'],
  })
  @IsOptional()
  @IsIn(['solo_dev', 'tech_lead', 'security_pro', 'unspecified'])
  readonly onboardingPersona?: string;

  @ApiProperty({
    description: 'Onboarding usage(s) selected by the user',
    required: false,
    isArray: true,
    enum: ['vibecoding', 'team_security', 'compliance', 'unspecified'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(['vibecoding', 'team_security', 'compliance', 'unspecified'], {
    each: true,
  })
  readonly onboardingUsage?: string[];

  constructor(notification: boolean, isOnboardingCompleted: boolean) {
    this.notification = notification;
    this.isOnboardingCompleted = isOnboardingCompleted;
  }

  public toString(): string {
    return JSON.stringify({
      notification: this.notification,
      isOnboardingCompleted: this.isOnboardingCompleted,
    });
  }
}
