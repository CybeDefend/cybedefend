import { localAuthRefusal } from './local-auth-refusals';

/** Passwords are 12 to 128 code points. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Throws `PASSWORD_POLICY` (INVALID_ARGUMENT) outside 12..128 code points.
 * The spread counts code points, so an emoji is one character.
 */
export function assertPasswordPolicy(password: string): void {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw localAuthRefusal('PASSWORD_POLICY');
  }
}
