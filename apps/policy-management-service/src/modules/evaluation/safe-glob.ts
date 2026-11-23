// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require('picomatch') as {
  isMatch: (
    subject: string,
    pattern: string | string[],
    options?: { noextglob?: boolean },
  ) => boolean;
};

/** Index of the `]` closing the class opened at `open`, or -1 when unclosed. */
const classEnd = (pattern: string, open: number): number => {
  let i = open + 1;
  if (pattern[i] === '!' || pattern[i] === '^') i++;
  if (pattern[i] === ']') i++;
  for (; i < pattern.length; i++) {
    if (pattern[i] === '\\') i++;
    else if (pattern[i] === ']') return i;
  }
  return -1;
};

/** Index of the `)` closing the group opened at `open`, or the end of input. */
const groupEnd = (pattern: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '[') {
      const end = classEnd(pattern, i);
      if (end !== -1) i = end;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      return i;
    }
  }
  return pattern.length;
};

/** Splits an extglob body on its top-level `|`. */
const splitBranches = (body: string): string[] => {
  const branches: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') i++;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      branches.push(body.slice(from, i));
      from = i + 1;
    }
  }
  branches.push(body.slice(from));
  return branches;
};

/** Characters that give a branch any meaning beyond its literal text. */
const GLOB_SYNTAX = /[*?[\]()|\\!@+{}]/;

/**
 * A repeated body is safe when every branch is plain, non-empty text and no
 * branch is a prefix of another: such a set is a prefix code, so the regex
 * engine reads it left to right without ever backtracking into the repeat.
 */
const isSafeRepeatedBody = (body: string): boolean => {
  const branches = splitBranches(body);
  if (branches.some((b) => b === '' || GLOB_SYNTAX.test(b))) return false;
  return branches.every((a, i) =>
    branches.every((b, j) => i === j || !b.startsWith(a)),
  );
};

/**
 * True when the pattern holds a repeated extglob, `+(...)` or `*(...)`, other
 * than a repeat of plain, prefix-free alternatives. picomatch compiles the
 * body inside a regex quantifier, and a body that can match the same text in
 * more than one way (`*a`, `[a]|?(a)`, `a|aa`) backtracks exponentially on a
 * short subject that fails to match. picomatch up to and including 4.0.7 only
 * catches some of these shapes.
 */
export const hasRiskyRepeatedExtglob = (pattern: string): boolean => {
  for (let i = 0; i < pattern.length - 1; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') {
      const end = classEnd(pattern, i);
      if (end !== -1) i = end;
      continue;
    }
    if ((ch === '+' || ch === '*') && pattern[i + 1] === '(') {
      const close = groupEnd(pattern, i + 1);
      if (!isSafeRepeatedBody(pattern.slice(i + 2, close))) return true;
    }
  }
  return false;
};

/**
 * Glob match for patterns written by policy authors. A pattern holding a risky
 * repeated extglob is matched with extglobs turned off: its `+(`, `*(`, `@(`…
 * become literal characters while `*`, `?` and `**` keep their meaning. Every
 * other pattern keeps picomatch's full syntax.
 */
export const globMatch = (subject: string, pattern: string): boolean =>
  hasRiskyRepeatedExtglob(pattern)
    ? picomatch.isMatch(subject, pattern, { noextglob: true })
    : picomatch.isMatch(subject, pattern);
