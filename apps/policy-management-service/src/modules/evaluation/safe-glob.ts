import { Logger } from '@nestjs/common';

// picomatch turns a glob into the source of a regular expression. Its parser
// is a single pass over the pattern; only running the resulting expression on
// a backtracking engine can take exponential time, and that is not done here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require('picomatch') as {
  makeRe: (pattern: string) => RegExp;
};

/**
 * Glob matching for patterns written by policy authors (exclusion patterns,
 * branch rules), matched against file paths and branch names that come from
 * the scanned repository.
 *
 * Patterns keep the exact meaning they always had: picomatch still reads the
 * glob and writes the equivalent regular expression. That expression is then
 * run by the automaton below instead of the JavaScript engine, which
 * backtracks and can take exponential time on a chain of `*` or a repeated
 * group. The automaton never backtracks: it keeps the set of states reached
 * after each character, so one match visits each state a bounded number of
 * times per character of the path. Lookarounds, which picomatch uses for
 * hidden files and negated groups, are answered for every position of the
 * path at once, by one more pass of their own automaton.
 */

/** Longest pattern accepted when a policy is written. */
export const MAX_GLOB_PATTERN_LENGTH = 256;
/** Most wildcards (runs of `*`, and `?`) accepted when a policy is written. */
export const MAX_GLOB_WILDCARDS = 10;
/** Longest path or branch name matched; a longer one matches no pattern. */
export const MAX_GLOB_SUBJECT_LENGTH = 4096;
/** Most automaton states for one pattern. */
export const MAX_GLOB_STATES = 8192;
/** Largest counted repetition (`{n,m}`) expanded in an expression. */
const MAX_COUNTED_REPEAT = 64;

/** Counts the automaton steps of one match, so a test can bound the work. */
export interface GlobMeter {
  steps: number;
}

class UnsupportedError extends Error {}

type CharTest = (code: number) => boolean;

type RNode =
  | { k: 'char'; test: CharTest }
  | { k: 'seq'; items: RNode[] }
  | { k: 'alt'; options: RNode[] }
  | { k: 'rep'; node: RNode; min: number; max: number }
  | { k: 'assert'; pred: number };

/** Position predicates: ^, $, \b, \B, then one per lookaround. */
const PRED_START = 0;
const PRED_END = 1;
const PRED_WORD = 2;
const PRED_NOT_WORD = 3;
const PRED_LOOK = 4;

interface Lookaround {
  behind: boolean;
  negate: boolean;
  body: RNode;
}

const isLineTerminator = (c: number): boolean =>
  c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isWordChar = (c: number): boolean =>
  isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c: number): boolean =>
  (c >= 9 && c <= 13) ||
  c === 32 ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

const CLASS_ESCAPES: Record<string, CharTest> = {
  d: isDigit,
  D: (c) => !isDigit(c),
  w: isWordChar,
  W: (c) => !isWordChar(c),
  s: isSpace,
  S: (c) => !isSpace(c),
};

const CONTROL_ESCAPES: Record<string, number> = {
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  f: 12,
};

const literal = (code: number): RNode => ({
  k: 'char',
  test: (c) => c === code,
});

/**
 * Reads the regular expressions picomatch writes (JavaScript syntax, no
 * flags). Anything this reader does not know is refused rather than guessed.
 */
class RegexReader {
  private i = 0;
  readonly looks: Lookaround[] = [];

  constructor(private readonly s: string) {}

  read(): RNode {
    const node = this.alternation();
    if (this.i < this.s.length) {
      throw new UnsupportedError(`unexpected "${this.s[this.i]}"`);
    }
    return node;
  }

  private alternation(): RNode {
    const options = [this.sequence()];
    while (this.s[this.i] === '|') {
      this.i++;
      options.push(this.sequence());
    }
    return options.length === 1 ? options[0] : { k: 'alt', options };
  }

  private sequence(): RNode {
    const items: RNode[] = [];
    while (this.i < this.s.length && this.s[this.i] !== '|') {
      if (this.s[this.i] === ')') break;
      const atom = this.atom();
      items.push(this.quantified(atom));
    }
    return { k: 'seq', items };
  }

  private quantified(atom: RNode): RNode {
    const s = this.s;
    let min: number;
    let max: number;
    const ch = s[this.i];
    if (ch === '*') {
      min = 0;
      max = Infinity;
      this.i++;
    } else if (ch === '+') {
      min = 1;
      max = Infinity;
      this.i++;
    } else if (ch === '?') {
      min = 0;
      max = 1;
      this.i++;
    } else if (ch === '{') {
      const counted = /^\{(\d+)(,(\d*))?\}/.exec(s.slice(this.i));
      if (!counted) return atom;
      min = Number(counted[1]);
      max =
        counted[2] === undefined
          ? min
          : counted[3] === ''
            ? Infinity
            : Number(counted[3]);
      if (
        min > MAX_COUNTED_REPEAT ||
        (max !== Infinity && max > MAX_COUNTED_REPEAT)
      ) {
        throw new UnsupportedError('a counted repetition is too large');
      }
      this.i += counted[0].length;
    } else {
      return atom;
    }
    if (s[this.i] === '?') this.i++; // lazy: same set of matches
    return { k: 'rep', node: atom, min, max };
  }

  private atom(): RNode {
    const s = this.s;
    const ch = s[this.i];
    if (ch === '(') return this.group();
    if (ch === '[') return this.charClass();
    this.i++;
    switch (ch) {
      case '.':
        return { k: 'char', test: (c) => !isLineTerminator(c) };
      case '^':
        return { k: 'assert', pred: PRED_START };
      case '$':
        return { k: 'assert', pred: PRED_END };
      case '\\':
        return this.escape();
      case '*':
      case '+':
      case '?':
        throw new UnsupportedError('nothing to repeat');
      case '{':
        if (/^\d+(,\d*)?\}/.test(s.slice(this.i))) {
          throw new UnsupportedError('nothing to repeat');
        }
        return literal(ch.charCodeAt(0));
      default:
        return literal(ch.charCodeAt(0));
    }
  }

  private group(): RNode {
    const s = this.s;
    this.i++; // (
    let look: Omit<Lookaround, 'body'> | null = null;
    if (s[this.i] === '?') {
      const kind = s.slice(this.i, this.i + 3);
      if (kind.startsWith('?:')) {
        this.i += 2;
      } else if (kind.startsWith('?=') || kind.startsWith('?!')) {
        look = { behind: false, negate: kind[1] === '!' };
        this.i += 2;
      } else if (kind === '?<=' || kind === '?<!') {
        look = { behind: true, negate: kind[2] === '!' };
        this.i += 3;
      } else {
        throw new UnsupportedError('unsupported group');
      }
    }
    const body = this.alternation();
    if (s[this.i] !== ')') throw new UnsupportedError('unclosed group');
    this.i++;
    if (!look) return body;
    // Inner lookarounds are registered first, so they are answered first.
    this.looks.push({ ...look, body });
    return { k: 'assert', pred: PRED_LOOK + this.looks.length - 1 };
  }

  /** One escaped character, as a code, or a set test. */
  private escapedCode(inClass: boolean): number | CharTest {
    const s = this.s;
    const ch = s[this.i];
    if (ch === undefined) throw new UnsupportedError('trailing "\\"');
    this.i++;
    if (CLASS_ESCAPES[ch]) return CLASS_ESCAPES[ch];
    if (CONTROL_ESCAPES[ch] !== undefined) return CONTROL_ESCAPES[ch];
    if (ch === 'b' && inClass) return 8;
    if (ch >= '1' && ch <= '9') {
      throw new UnsupportedError('back references are not supported');
    }
    if (ch === '0') {
      if (isDigit(s.charCodeAt(this.i) || 0)) {
        throw new UnsupportedError('octal escapes are not supported');
      }
      return 0;
    }
    if (ch === 'c') throw new UnsupportedError('control escapes');
    if (ch === 'x' && /^[0-9a-fA-F]{2}/.test(s.slice(this.i))) {
      const code = parseInt(s.slice(this.i, this.i + 2), 16);
      this.i += 2;
      return code;
    }
    if (ch === 'u' && /^[0-9a-fA-F]{4}/.test(s.slice(this.i))) {
      const code = parseInt(s.slice(this.i, this.i + 4), 16);
      this.i += 4;
      return code;
    }
    return ch.charCodeAt(0);
  }

  private escape(): RNode {
    const s = this.s;
    if (s[this.i] === 'b') {
      this.i++;
      return { k: 'assert', pred: PRED_WORD };
    }
    if (s[this.i] === 'B') {
      this.i++;
      return { k: 'assert', pred: PRED_NOT_WORD };
    }
    const code = this.escapedCode(false);
    return typeof code === 'number' ? literal(code) : { k: 'char', test: code };
  }

  private charClass(): RNode {
    const s = this.s;
    this.i++; // [
    let negate = false;
    if (s[this.i] === '^') {
      negate = true;
      this.i++;
    }
    const ranges: number[] = [];
    const tests: CharTest[] = [];
    const item = (): number | CharTest => {
      const ch = s[this.i];
      this.i++;
      return ch === '\\' ? this.escapedCode(true) : ch.charCodeAt(0);
    };
    while (this.i < s.length && s[this.i] !== ']') {
      const lo = item();
      if (s[this.i] === '-' && this.i + 1 < s.length && s[this.i + 1] !== ']') {
        this.i++; // -
        const hi = item();
        if (typeof lo === 'number' && typeof hi === 'number') {
          if (hi < lo) throw new UnsupportedError('invalid range');
          ranges.push(lo, hi);
          continue;
        }
        // A set escape at either end: both ends and "-" are members.
        for (const end of [lo, hi]) {
          if (typeof end === 'number') ranges.push(end, end);
          else tests.push(end);
        }
        ranges.push(45, 45);
        continue;
      }
      if (typeof lo === 'number') ranges.push(lo, lo);
      else tests.push(lo);
    }
    if (s[this.i] !== ']') throw new UnsupportedError('unclosed class');
    this.i++;
    const test: CharTest = (c) => {
      let inside = false;
      for (let r = 0; r < ranges.length && !inside; r += 2) {
        inside = c >= ranges[r] && c <= ranges[r + 1];
      }
      for (let t = 0; t < tests.length && !inside; t++) inside = tests[t](c);
      return inside !== negate;
    };
    return { k: 'char', test };
  }
}

const KIND_CHAR = 0;
const KIND_SPLIT = 1;
const KIND_ASSERT = 2;
const KIND_MATCH = 3;

/**
 * A Thompson automaton. KIND_CHAR reads one character, KIND_SPLIT forks
 * without reading, KIND_ASSERT passes when its position predicate holds,
 * KIND_MATCH accepts. Built backwards for a lookahead, which is answered by
 * reading the path from its end.
 */
class Automaton {
  kind: number[] = [];
  test: (CharTest | null)[] = [];
  pred: number[] = [];
  a: number[] = [];
  b: number[] = [];
  start = 0;

  constructor(
    root: RNode,
    private readonly reverse: boolean,
    private readonly budget: { states: number },
  ) {
    const match = this.add(KIND_MATCH, null, -1, -1, -1);
    this.start = this.build(root, match);
  }

  get size(): number {
    return this.kind.length;
  }

  private add(
    kind: number,
    test: CharTest | null,
    pred: number,
    a: number,
    b: number,
  ): number {
    if (++this.budget.states > MAX_GLOB_STATES) {
      throw new UnsupportedError(
        `the pattern compiles to more than ${MAX_GLOB_STATES} states`,
      );
    }
    this.kind.push(kind);
    this.test.push(test);
    this.pred.push(pred);
    this.a.push(a);
    this.b.push(b);
    return this.kind.length - 1;
  }

  private build(node: RNode, next: number): number {
    switch (node.k) {
      case 'char':
        return this.add(KIND_CHAR, node.test, -1, next, -1);
      case 'assert':
        return this.add(KIND_ASSERT, null, node.pred, next, -1);
      case 'seq': {
        let at = next;
        const items = node.items;
        if (this.reverse) {
          for (let k = 0; k < items.length; k++) at = this.build(items[k], at);
        } else {
          for (let k = items.length - 1; k >= 0; k--) {
            at = this.build(items[k], at);
          }
        }
        return at;
      }
      case 'alt': {
        const entries = node.options.map((o) => this.build(o, next));
        let at = entries[entries.length - 1];
        for (let k = entries.length - 2; k >= 0; k--) {
          at = this.add(KIND_SPLIT, null, -1, entries[k], at);
        }
        return at;
      }
      case 'rep': {
        let tail = next;
        if (node.max === Infinity) {
          const loop = this.add(KIND_SPLIT, null, -1, -1, next);
          this.a[loop] = this.build(node.node, loop);
          tail = loop;
        } else {
          for (let k = 0; k < node.max - node.min; k++) {
            tail = this.add(
              KIND_SPLIT,
              null,
              -1,
              this.build(node.node, tail),
              next,
            );
          }
        }
        for (let k = 0; k < node.min; k++) tail = this.build(node.node, tail);
        return tail;
      }
    }
  }

  /**
   * Reads the subject once. Forward, `found[p]` says a match ends at p
   * (start states are added at every position); backward, it says a match
   * starts at p. With `stopAtFirst`, returns as soon as any match is found.
   */
  run(
    subject: string,
    holds: (pred: number, p: number) => boolean,
    meter: GlobMeter,
    stopAtFirst: boolean,
  ): { any: boolean; found: Uint8Array | null } {
    const n = subject.length;
    const found = stopAtFirst ? null : new Uint8Array(n + 1);
    const seen = new Int32Array(this.size).fill(-1);
    const stack: number[] = [];
    let current: number[] = [];
    let accepted = false;

    const close = (state: number, p: number, into: number[]): void => {
      stack.push(state);
      while (stack.length > 0) {
        const st = stack.pop()!;
        if (st < 0 || seen[st] === p) continue;
        seen[st] = p;
        meter.steps++;
        const kind = this.kind[st];
        if (kind === KIND_SPLIT) {
          stack.push(this.b[st], this.a[st]);
        } else if (kind === KIND_ASSERT) {
          if (holds(this.pred[st], p)) stack.push(this.a[st]);
        } else {
          if (kind === KIND_MATCH) accepted = true;
          into.push(st);
        }
      }
    };

    for (let step = 0; step <= n; step++) {
      const p = this.reverse ? n - step : step;
      accepted = false;
      close(this.start, p, current);
      if (accepted) {
        if (stopAtFirst) return { any: true, found };
        found![p] = 1;
      }
      if (step === n) break;
      const c = subject.charCodeAt(this.reverse ? p - 1 : p);
      const target = this.reverse ? p - 1 : p + 1;
      const moved = current;
      current = [];
      accepted = false;
      for (const st of moved) {
        meter.steps++;
        if (this.kind[st] === KIND_CHAR && this.test[st]!(c)) {
          close(this.a[st], target, current);
        }
      }
      if (accepted) {
        if (stopAtFirst) return { any: true, found };
        found![target] = 1;
      }
    }
    return { any: false, found };
  }
}

/** A pattern ready to match, built once and reused. */
export class CompiledGlob {
  private readonly main: Automaton;
  private readonly looks: { automaton: Automaton; negate: boolean }[];

  constructor(
    private readonly pattern: string,
    root: RNode,
    looks: Lookaround[],
  ) {
    const budget = { states: 0 };
    this.looks = looks.map((look) => ({
      automaton: new Automaton(look.body, !look.behind, budget),
      negate: look.negate,
    }));
    this.main = new Automaton(root, false, budget);
  }

  /** Automaton states in all, every alternative and lookaround included. */
  get size(): number {
    return this.looks.reduce(
      (sum, l) => sum + l.automaton.size,
      this.main.size,
    );
  }

  /** The previous library's answer: an exact copy of the pattern matches. */
  match(subject: string, meter: GlobMeter = { steps: 0 }): boolean {
    if (subject === '') return false;
    if (subject === this.pattern) return true;
    const n = subject.length;
    const answers: Uint8Array[] = [];
    const holds = (pred: number, p: number): boolean => {
      switch (pred) {
        case PRED_START:
          return p === 0;
        case PRED_END:
          return p === n;
        case PRED_WORD:
        case PRED_NOT_WORD: {
          const before = p > 0 && isWordChar(subject.charCodeAt(p - 1));
          const after = p < n && isWordChar(subject.charCodeAt(p));
          return (before !== after) === (pred === PRED_WORD);
        }
        default:
          return answers[pred - PRED_LOOK][p] === 1;
      }
    };
    for (const look of this.looks) {
      const { found } = look.automaton.run(subject, holds, meter, false);
      if (look.negate) for (let p = 0; p <= n; p++) found![p] ^= 1;
      answers.push(found!);
    }
    return this.main.run(subject, holds, meter, true).any;
  }
}

/** Builds a pattern, or names why it cannot be matched in bounded time. */
export const compileGlob = (
  pattern: string,
): { glob: CompiledGlob } | { error: string } => {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { error: 'the pattern is empty' };
  }
  let source: string;
  try {
    const re = picomatch.makeRe(pattern);
    if (re.flags !== '') return { error: 'unexpected expression flags' };
    source = re.source;
  } catch (error) {
    return { error: `not a valid pattern (${(error as Error).message})` };
  }
  try {
    const reader = new RegexReader(source);
    const root = reader.read();
    return { glob: new CompiledGlob(pattern, root, reader.looks) };
  } catch (error) {
    if (error instanceof UnsupportedError) return { error: error.message };
    throw error;
  }
};

/** Runs of `*`, and `?`, outside character classes and escapes. */
const countWildcards = (pattern: string): number => {
  let count = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i + 2);
      if (close !== -1) i = close;
    } else if (ch === '?') {
      count++;
    } else if (ch === '*') {
      count++;
      while (pattern[i + 1] === '*') i++;
    }
  }
  return count;
};

/**
 * Why a pattern is refused when a policy is written, or null. Past the caps
 * or unmatchable is refused; a pattern the previous library compiled to an
 * expression that never matches is refused as invalid.
 */
export const globPatternError = (pattern: string): string | null => {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return 'the pattern is empty';
  }
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
    return `the pattern is longer than ${MAX_GLOB_PATTERN_LENGTH} characters`;
  }
  if (countWildcards(pattern) > MAX_GLOB_WILDCARDS) {
    return `the pattern holds more than ${MAX_GLOB_WILDCARDS} wildcards`;
  }
  const compiled = compileGlob(pattern);
  if ('error' in compiled) return compiled.error;
  try {
    if (picomatch.makeRe(pattern).source === '$^') {
      return 'not a valid pattern';
    }
  } catch {
    return 'not a valid pattern';
  }
  return null;
};

const logger = new Logger('SafeGlob');
const CACHE_LIMIT = 1000;
const cache = new Map<string, CompiledGlob | string>();

const compiledFor = (pattern: string): CompiledGlob | string => {
  let compiled = cache.get(pattern);
  if (compiled === undefined) {
    const built = compileGlob(pattern);
    compiled = 'glob' in built ? built.glob : built.error;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(pattern, compiled);
  }
  return compiled;
};

/**
 * Matches a subject, or says why the match was skipped: a pattern that cannot
 * be matched in bounded time, or a subject past MAX_GLOB_SUBJECT_LENGTH.
 * A skipped match is never a match; the caller reports it.
 */
export const matchGlob = (
  subject: string,
  pattern: string,
  meter?: GlobMeter,
): { matched: boolean } | { skipped: string } => {
  const compiled = compiledFor(pattern);
  if (typeof compiled === 'string') return { skipped: compiled };
  if (subject.length > MAX_GLOB_SUBJECT_LENGTH) {
    return {
      skipped: `the path is longer than ${MAX_GLOB_SUBJECT_LENGTH} characters`,
    };
  }
  return { matched: compiled.match(subject, meter) };
};

/** True when the subject matches; a skipped match is logged and is false. */
export const globMatch = (
  subject: string,
  pattern: string,
  meter?: GlobMeter,
): boolean => {
  const result = matchGlob(subject, pattern, meter);
  if ('skipped' in result) {
    logger.warn(
      `Skipping the glob pattern ${JSON.stringify(pattern.slice(0, MAX_GLOB_PATTERN_LENGTH))}: ${result.skipped}`,
    );
    return false;
  }
  return result.matched;
};
