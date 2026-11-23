import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/**
 * The team table keeps the name and the description in 255-character
 * columns, and PostgreSQL refuses a NUL byte in any text column: a value the
 * database would refuse is a 400 here, never a failed query downstream.
 */
export const TEAM_TEXT_MAX_LENGTH = 255;

const NO_NUL_BYTE = /^[^\u0000]*$/;
const NOT_BLANK = /\S/;

/** A team name: 1–255 characters, at least one that is not white space, no NUL byte. */
export function TeamNameField(): PropertyDecorator {
  return applyDecorators(
    IsNotEmpty(),
    IsString(),
    Length(1, TEAM_TEXT_MAX_LENGTH),
    Matches(NOT_BLANK, { message: 'name must not be blank' }),
    Matches(NO_NUL_BYTE, { message: 'name must not contain a NUL byte' }),
  );
}

/** A team description: 1–255 characters, no NUL byte. */
export function TeamDescriptionField(): PropertyDecorator {
  return applyDecorators(
    IsNotEmpty(),
    IsString(),
    Length(1, TEAM_TEXT_MAX_LENGTH),
    Matches(NO_NUL_BYTE, {
      message: 'description must not contain a NUL byte',
    }),
  );
}
