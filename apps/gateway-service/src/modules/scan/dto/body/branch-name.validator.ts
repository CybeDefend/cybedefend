import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** The longest branch a scan stores. */
export const BRANCH_NAME_MAX_LENGTH = 255;

// Control characters, space, DEL and the characters Git refuses in a ref.
const FORBIDDEN_CHARACTER = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Whether `name` is a branch name Git would accept (`git check-ref-format
 * --branch`) that a scan can store: 1 to 255 characters, none of the
 * characters Git refuses, no `..` or `@{`, no empty or dot-led component, no
 * leading `-`, no trailing `.` or `.lock`.
 */
export function isGitBranchName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > BRANCH_NAME_MAX_LENGTH) return false;
  if (FORBIDDEN_CHARACTER.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name === '@') return false;
  if (name.startsWith('-') || name.endsWith('.')) return false;
  return name
    .split('/')
    .every(
      (part) =>
        part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'),
    );
}

@ValidatorConstraint({ name: 'isGitBranchName', async: false })
export class IsGitBranchName implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isGitBranchName(value);
  }

  defaultMessage(): string {
    return `branch must be a Git branch name of at most ${BRANCH_NAME_MAX_LENGTH} characters`;
  }
}
