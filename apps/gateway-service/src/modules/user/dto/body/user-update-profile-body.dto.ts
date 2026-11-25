// src/global-management/user/body/update-user-profile-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
} from 'class-validator';

/**
 * `onboardingProgress` is a JSON array of step ids: at most 4 KiB of JSON,
 * at most 100 ids, each 1 to 64 characters of `a-z 0-9 _ . : -`.
 * global-management applies the same bounds to every caller.
 */
export const ONBOARDING_PROGRESS_MAX_LENGTH = 4096;
export const ONBOARDING_PROGRESS_MAX_STEPS = 100;
const ONBOARDING_STEP_ID = /^[a-z0-9_.:-]{1,64}$/;

/** True for a JSON array of step ids within the bounds above. */
export function isOnboardingProgress(value: unknown): boolean {
  // The length first: a large value is never parsed.
  if (
    typeof value !== 'string' ||
    value.length > ONBOARDING_PROGRESS_MAX_LENGTH
  )
    return false;
  let steps: unknown;
  try {
    steps = JSON.parse(value);
  } catch {
    return false;
  }
  return (
    Array.isArray(steps) &&
    steps.length <= ONBOARDING_PROGRESS_MAX_STEPS &&
    steps.every((s) => typeof s === 'string' && ONBOARDING_STEP_ID.test(s))
  );
}

const IsOnboardingProgress = () =>
  ValidateBy({
    name: 'isOnboardingProgress',
    validator: {
      validate: (value: unknown) => isOnboardingProgress(value),
      defaultMessage: () =>
        `onboardingProgress must be a JSON array of at most ${ONBOARDING_PROGRESS_MAX_STEPS} step ids, ${ONBOARDING_PROGRESS_MAX_LENGTH} characters at most`,
    },
  });

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
    description:
      'JSON array of completed onboarding step IDs (at most 100 ids of 1 to 64 characters a-z 0-9 _ . : -, 4096 characters at most)',
    required: false,
    type: 'string',
    maxLength: ONBOARDING_PROGRESS_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(ONBOARDING_PROGRESS_MAX_LENGTH)
  @IsOnboardingProgress()
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
