import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/** The longest project name, in characters. */
export const PROJECT_NAME_MAX_LENGTH = 255;

/**
 * No control character: C0 (NUL included, which PostgreSQL refuses in a text
 * column), DEL and C1.
 */
const NO_CONTROL_CHARACTER = /^\P{Cc}*$/u;

/**
 * At least one visible character: something that is neither a space or
 * separator (`\p{Z}`, `\s`), a control character (`\p{Cc}`) nor an invisible
 * format character (`\p{Cf}`: zero-width space and joiners, word joiner, byte
 * order mark, soft hyphen...). A joiner inside a visible name stays allowed.
 */
const HAS_VISIBLE_CHARACTER = /[^\s\p{Z}\p{Cc}\p{Cf}]/u;

/**
 * The rules of a project name, the same when a project is created and when it
 * is renamed: a string, trimmed, from 1 to 255 characters, with no control
 * character and at least one visible character.
 *
 * The trim reads the raw body value (`obj[key]`), not the one the pipe's
 * implicit conversion produced, so a number is refused instead of being
 * turned into a string.
 */
export function ProjectNameRules(): PropertyDecorator {
  return applyDecorators(
    Transform(({ obj, key }) => {
      const raw: unknown = (obj as Record<string, unknown>)[key];
      return typeof raw === 'string' ? raw.trim() : raw;
    }),
    IsString(),
    IsNotEmpty(),
    Length(1, PROJECT_NAME_MAX_LENGTH),
    Matches(NO_CONTROL_CHARACTER, {
      message: 'name must not contain control characters',
    }),
    Matches(HAS_VISIBLE_CHARACTER, {
      message: 'name must contain at least one visible character',
    }),
  );
}
