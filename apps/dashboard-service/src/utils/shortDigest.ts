/**
 * Eight hex characters standing for a value, to key something in browser
 * storage without leaving the value itself there.
 *
 * A binding, not a secret: FNV-1a over 32 bits of the value's UTF-16 code
 * units. It tells two ids of one browser apart; a collision only makes two of
 * them share a flag. Never use it where an attacker gains from finding the
 * value back, or from forging a match.
 *
 * Its output is already in browsers (the next-start marker of
 * `utils/product.ts`, the checklist's stored flag): changing the function
 * orphans what was written with the previous one.
 */
export function shortDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
