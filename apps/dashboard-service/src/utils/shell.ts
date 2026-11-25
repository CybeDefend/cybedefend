/**
 * Helpers for the shell commands the application offers to copy. Such a
 * command runs in the user's terminal with the user's credentials, in a shell
 * the application does not know: a POSIX shell, fish, PowerShell or cmd.exe.
 * Quoting cannot be right for all of them (PowerShell takes typographic quotes
 * as quotes, cmd.exe has no single quotes, fish escapes inside them), so a
 * value is inserted only when it is made of characters none of them treats
 * specially; otherwise the command shows a placeholder.
 */

/** Characters a POSIX shell, bash and zsh read literally, the first one not an expansion. */
const SHELL_SAFE = /^[A-Za-z0-9._/+-][A-Za-z0-9._/:@=+-]*$/;

/** A value as one shell word: as is when it is safe, single-quoted otherwise. */
export function shellWord(value: string): string {
  return SHELL_SAFE.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A branch every shell reads literally: ASCII letters, digits, `.`, `_`, `/`
 * and `-`, not starting with `-`. Branch names in practice (`main`,
 * `feature/login-form`, `release-1.2.3`, `renovate/lodash-4.x`) use only
 * these; a rarer one gets the placeholder.
 */
const PLAIN_BRANCH = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;

/**
 * An image reference every shell reads literally: the branch set plus `:`
 * (the tag, a registry port) and `@` (the digest), none of them first.
 */
const PLAIN_IMAGE = /^[A-Za-z0-9._/][A-Za-z0-9._/:@-]*$/;

/**
 * One word of a command received from the API: the image set plus `=` and `+`
 * inside the word (`requests==2.31.0`), not starting with `-` or `@`.
 */
const PLAIN_COMMAND_WORD = /^[A-Za-z0-9._/][A-Za-z0-9._/:@=+-]*$/;

/** The options of the install commands the API sends. */
const PLAIN_COMMAND_OPTIONS: ReadonlySet<string> = new Set(['--version', '-v']);

export const isPlainBranch = (value: string): boolean => PLAIN_BRANCH.test(value);

export const isPlainImage = (value: string): boolean => PLAIN_IMAGE.test(value);

/**
 * True for a command received from the API that may be offered for copy: words
 * separated by single spaces, each a plain word or one of the known options.
 */
export const isPlainCommand = (value: string): boolean =>
  value.length > 0 &&
  value.split(' ').every((word) => PLAIN_COMMAND_OPTIONS.has(word) || PLAIN_COMMAND_WORD.test(word));
