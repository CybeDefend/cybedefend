import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No screen shows the server's or the HTTP client's own text for a failed
 * call. The gateway's `message` is written for developers (English,
 * class-validator details) and axios's `message` is « Request failed with
 * status code N »: a user reads a translated sentence instead, from
 * `apiErrorKey` / `apiErrorText` (`utils/function/apiErrorKey.ts`) or from a
 * screen's own closed list of refusals.
 *
 * The scan covers the core sources (closed code and tests aside). It reads
 * the error variable names used across the code (`err`, `error`, `e`). A line
 * that reads the server's text to compare it, never to show it, ends with
 * `// not shown: <reason>`.
 */
const ROOT = join(__dirname, '..', '..');

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/response\??\.data\??\.message/, 'the server body message'],
  [/\bgetApiErrorMessage\(/, 'the raw-message helper'],
  [/\b(?:toast|notify)\.(?:error|warning|warn|info)\(\s*(?:\(\s*\w+\s+as\s+\w+\s*\)|err|error|e)\??\.message\b/, 'an error message in a toast'],
  [/\bset\w*Errors?\(\s*\[?\s*(?:err|error|e)\??\.message\b/, 'an error message stored for display'],
  [/\{\s*(?:err|error)\??\.message\s*\}/, 'an error message rendered'],
  [/rejectWithValue\(\s*(?:err|error|e)\??\.message\b/, 'an error message handed to the store'],
  [/(?:=|^)\s*(?:err|error|e)\??\.message\s*(?:\|\||\?\?)/, 'an error message picked as text'],
  [/\btoast\.\w+\(\s*response\??\.message\b/, 'a server success message in a toast'],
  [/^\s*response\??\.message\s*(?:\|\||\?\?)/, 'a server success message picked as text'],
];

/** A line that reads the server's text only to compare it says so: `// not shown: <reason>`. */
const NOT_SHOWN = /\/\/ not shown: \S/;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'ee' || name === 'node_modules' || name === 'test') continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
};

describe('no raw server text shown to users', () => {
  it('no core source shows an API or HTTP-client error message', () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line) || NOT_SHOWN.test(line)) return;
        for (const [pattern, what] of FORBIDDEN) {
          if (pattern.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1} ${what}: ${line.trim()}`);
        }
      });
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
