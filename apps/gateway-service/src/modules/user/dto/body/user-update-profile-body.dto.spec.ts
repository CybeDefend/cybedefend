import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import {
  ONBOARDING_PROGRESS_MAX_LENGTH,
  ONBOARDING_PROGRESS_MAX_STEPS,
  UpdateUserProfileBodyDto,
} from './user-update-profile-body.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UpdateUserProfileBodyDto });

describe('UpdateUserProfileBodyDto.onboardingProgress', () => {
  it('accepts what the dashboard sends: a JSON array of step ids', async () => {
    for (const value of [
      JSON.stringify(['first_project']),
      JSON.stringify(['product_choice_v1', 'org_created']),
      JSON.stringify([]),
    ]) {
      await expect(validate({ onboardingProgress: value })).resolves.toEqual(
        expect.objectContaining({ onboardingProgress: value }),
      );
    }
  });

  it(`refuses a value longer than ${ONBOARDING_PROGRESS_MAX_LENGTH} characters`, async () => {
    expect(ONBOARDING_PROGRESS_MAX_LENGTH).toBe(4096);
    const value = JSON.stringify(['a'.repeat(64)]).padEnd(4097, ' ');
    await expect(
      validate({ onboardingProgress: value }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validate({ onboardingProgress: 'x'.repeat(10 * 1024 * 1024) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an object', '{"a":1}'],
    ['a string', '"first_project"'],
    ['a number in the array', '[1]'],
    ['an id with a space', '["has space"]'],
    ['an id with markup', '["<b>"]'],
    ['an id over 64 characters', JSON.stringify(['a'.repeat(65)])],
    ['an empty id', '[""]'],
    [
      `more than ${ONBOARDING_PROGRESS_MAX_STEPS} ids`,
      JSON.stringify(
        Array.from(
          { length: ONBOARDING_PROGRESS_MAX_STEPS + 1 },
          (_, i) => `s${i}`,
        ),
      ),
    ],
  ])('refuses %s', async (_label, value) => {
    await expect(
      validate({ onboardingProgress: value }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the field optional', async () => {
    await expect(validate({ notification: true })).resolves.toBeDefined();
  });
});
