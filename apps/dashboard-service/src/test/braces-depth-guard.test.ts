// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * braces <= 3.0.3 (CVE-2026-93687, GHSA-vfj7-8cjw-p6xm)
 * caps its input at 10,000 characters but not its brace nesting, and its
 * compile, expand and stringify walkers recurse once per level: 4,900 nested
 * pairs (9,800 characters) end in "Maximum call stack size exceeded". No
 * release fixes it, so `patches/braces@3.0.3.patch` caps the nesting in
 * `parse`, the one non-recursive step every walker starts from.
 *
 * The copy under test is the one Tailwind loads at build time (through
 * micromatch and fast-glob), not a copy of our own.
 */
type BracesOptions = Record<string, unknown>;
type Braces = {
  (pattern: string, options?: BracesOptions): string[];
  expand(pattern: string, options?: BracesOptions): string[];
  stringify(pattern: string, options?: BracesOptions): string;
};
type Micromatch = { braces(pattern: string, options?: BracesOptions): string[] };

const fromDashboard = createRequire(path.resolve(__dirname, '../../package.json'));
const fromTailwind = createRequire(fromDashboard.resolve('tailwindcss'));
const micromatch = fromTailwind('micromatch') as Micromatch;
const braces = createRequire(fromTailwind.resolve('micromatch'))('braces') as Braces;

// The options fast-glob passes when Tailwind expands its `content` globs.
const FAST_GLOB = { expand: true, nodupes: true, keepEscaping: true };

const nest = (levels: number) => '{'.repeat(levels) + '}'.repeat(levels);
const DEEP = 4900;
const NESTING_LIMIT = /maximum nesting depth/;

describe('braces nesting guard (CVE-2026-93687)', () => {
  it.each([
    ['braces() (compile)', () => braces(nest(DEEP))],
    ['braces.expand', () => braces.expand(nest(DEEP))],
    ['braces.stringify', () => braces.stringify(nest(DEEP))],
    ['a ${…} block, which expand stringifies whole', () => braces.expand('$' + nest(DEEP))],
    ['micromatch.braces as fast-glob calls it', () => micromatch.braces(nest(DEEP), FAST_GLOB)],
  ])('%s rejects a deeply nested pattern with a RangeError naming the limit', (_, run) => {
    expect(run).toThrow(RangeError);
    expect(run).toThrow(NESTING_LIMIT);
  });

  it('accepts 64 nesting levels and rejects the 65th', () => {
    expect(() => braces.expand(nest(64))).not.toThrow();
    expect(() => braces.expand(nest(65))).toThrow(NESTING_LIMIT);
  });

  it('lets options.maxDepth move the limit, like maxLength and rangeLimit', () => {
    expect(() => braces.expand(nest(100), { maxDepth: 100 })).not.toThrow();
    expect(() => braces.expand(nest(3), { maxDepth: 2 })).toThrow(NESTING_LIMIT);
  });

  // Recorded from the unpatched 3.0.3: the guard must not change any output.
  it.each([
    ['./src/**/*.{js,jsx,ts,tsx}', ['./src/**/*.(js|jsx|ts|tsx)'], ['./src/**/*.js', './src/**/*.jsx', './src/**/*.ts', './src/**/*.tsx']],
    ['a/{b,c}/d', ['a/(b|c)/d'], ['a/b/d', 'a/c/d']],
    ['{1..3}', ['([1-3])'], ['1', '2', '3']],
    ['x{a..c}y', ['x([a-c])y'], ['xay', 'xby', 'xcy']],
    ['{a,b{1..2}}', ['(a|b(1|2))'], ['a', 'b1', 'b2']],
    ['{a,{b,{c,d}}}', ['(a|(b|(c|d)))'], ['a', 'b', 'c', 'd']],
    ['a{1..3}b{c,d}', ['a([1-3])b(c|d)'], ['a1bc', 'a1bd', 'a2bc', 'a2bd', 'a3bc', 'a3bd']],
    ['${a,b}', ['${a,b}'], ['${a,b}']],
    ['{a,b', ['{a,b'], ['{a,b']],
    ['{}', ['{}'], ['{}']],
  ])('%s compiles and expands as before', (pattern, compiled, expanded) => {
    expect(braces(pattern)).toEqual(compiled);
    expect(braces.expand(pattern)).toEqual(expanded);
    expect(micromatch.braces(pattern, FAST_GLOB)).toEqual(expanded);
    expect(braces.stringify(pattern)).toBe(pattern);
  });
});
