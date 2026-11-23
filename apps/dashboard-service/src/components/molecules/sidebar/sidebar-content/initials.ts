/**
 * The letters of an avatar disc without a picture: the first letter of the
 * first two words of the name, in capitals (« Acme Corp » reads AC, « Ada
 * Lovelace » AL), one letter for a one-word name, a question mark for none.
 */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters || '?';
}
