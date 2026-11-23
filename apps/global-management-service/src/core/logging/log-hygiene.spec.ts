import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * What global-management's core code writes to its logs.
 *
 * - A refusal the caller caused (not found, already exists, permission
 *   denied, invalid argument, failed precondition, resource exhausted) is an
 *   answer, not a fault of the service: it is logged at WARN at most, so an
 *   ERROR line still means something broke.
 * - No log line interpolates an e-mail address: logs are shipped and kept far
 *   longer than the data they describe, and an address is personal data. A
 *   line names the user or invitation id instead.
 *
 * Walks `src/`, skipping the closed edition's code, the migrations, the
 * generated gRPC code and the specs.
 */

const SRC = join(__dirname, '..', '..');
const SKIPPED_DIRS = [
  'ee',
  'core/grpc',
  'core/migrations',
  'core/migrations-postgres',
  'core/migrations-common',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(SRC, path).split(sep).join('/');
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.includes(rel)) out.push(...sourceFiles(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push(path);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split('\n').length;

const CLIENT_REFUSALS =
  'NOT_FOUND|ALREADY_EXISTS|PERMISSION_DENIED|INVALID_ARGUMENT|FAILED_PRECONDITION|RESOURCE_EXHAUSTED|UNAUTHENTICATED';

describe('global-management log hygiene (core source)', () => {
  it('walks the core source', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('logs no refusal of the caller at ERROR', () => {
    const errorThenRefusal = new RegExp(
      String.raw`this\.logger\.error\(((?:(?!this\.logger|throw\b)[\s\S]){0,400}?)\);\s*\n\s*throw new RpcException\(\{\s*code:\s*status\.(?:${CLIENT_REFUSALS})\b`,
      'g',
    );
    const hits = FILES.flatMap(({ rel, text }) =>
      [...text.matchAll(errorThenRefusal)].map(
        (m) => `${rel}:${lineOf(text, m.index)}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it('interpolates no e-mail address into a log line', () => {
    const loggerCall =
      /this\.logger\.(?:log|warn|error|debug|verbose|info)\(((?:(?!this\.logger)[\s\S]){0,400}?)\);/g;
    const emailValue = /\$\{[^}]*\b(?:email|to)\b[^}]*\}|\b(?:email|to):/i;
    const hits = FILES.flatMap(({ rel, text }) =>
      [...text.matchAll(loggerCall)]
        .filter((m) => emailValue.test(m[1]))
        .map((m) => `${rel}:${lineOf(text, m.index)}`),
    );
    expect(hits).toEqual([]);
  });
});
