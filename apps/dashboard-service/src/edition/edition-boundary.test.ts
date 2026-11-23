import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * The core of the dashboard never imports the closed `src/ee/` tree: only
 * `src/edition/ee-entry.tsx` may, so the Community overlay can replace that one
 * file. The dashboard has no ESLint; this walk is its enforcement, like
 * the other `__guards__` tests.
 *
 * Every import form is read with the TypeScript compiler's own preprocessor,
 * so an alias, a relative path or a re-export is caught the same way. A
 * violation is keyed `"<file>|<specifier>"` in `edition-boundary.baseline.json`;
 * an entry the code no longer has fails, so the list cannot rot.
 */
const SRC = path.resolve(__dirname, '..');
const SERVICE_ROOT = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'edition-boundary.baseline.json');

/** `src/ee/**` itself, and the one core file allowed to import it. */
const SKIP_FILES = new Set(['src/edition/ee-entry.tsx']);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const toServiceRel = (file: string): string =>
  path.relative(SERVICE_ROOT, file).split(path.sep).join('/');

interface Violation {
  file: string;
  line: number;
  specifier: string;
}

/** Every import of `src/ee` (alias, `src/*` or relative) in one file's text. */
function findViolations(file: string, text: string): Violation[] {
  const rel = toServiceRel(file);
  const out: Violation[] = [];
  for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
    const specifier = ref.fileName;
    let forbidden = /^@\/ee(\/|$)/.test(specifier) || /^src\/ee(\/|$)/.test(specifier);
    if (!forbidden && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      const resolved = path
        .relative(SRC, path.resolve(path.dirname(file), specifier))
        .split(path.sep)
        .join('/');
      forbidden = resolved === 'ee' || resolved.startsWith('ee/');
    }
    if (forbidden) {
      out.push({ file: rel, line: text.slice(0, ref.pos).split('\n').length, specifier });
    }
  }
  return out;
}

function walkViolations(): Violation[] {
  return sourceFiles(SRC).flatMap((file) => {
    const rel = toServiceRel(file);
    if (rel === 'src/ee' || rel.startsWith('src/ee/') || SKIP_FILES.has(rel)) return [];
    return findViolations(file, fs.readFileSync(file, 'utf8'));
  });
}

function readBaseline(): string[] {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as string[];
}

describe('the edition boundary', () => {
  it('flags @/ee, src/ee and a relative path into src/ee, naming file and line', () => {
    const violations = [
      ...findViolations(path.join(SRC, 'pages/X.tsx'), "import { eeSlots } from '@/ee/entry';"),
      ...findViolations(path.join(SRC, 'pages/Y.ts'), "import { eeRoutes } from 'src/ee/entry';"),
      ...findViolations(path.join(SRC, 'modules/a/B.ts'), "import { eeAuthClient } from '../../ee/entry';"),
      ...findViolations(
        path.join(SRC, 'pages/C.ts'),
        "export { eeSlots } from '@/ee/entry';\nconst one = 1;",
      ),
      ...findViolations(
        path.join(SRC, 'pages/D.ts'),
        "import type { SlotRegistration } from '@/ee/entry';\nconst two = 2;",
      ),
    ];
    expect(violations.map((v) => `${v.file}:${v.line} '${v.specifier}'`)).toEqual([
      "src/pages/X.tsx:1 '@/ee/entry'",
      "src/pages/Y.ts:1 'src/ee/entry'",
      "src/modules/a/B.ts:1 '../../ee/entry'",
      "src/pages/C.ts:1 '@/ee/entry'",
      "src/pages/D.ts:1 '@/ee/entry'",
    ]);
  });

  it('does not flag @/edition/ee-entry, @/eel or ./ee-like', () => {
    const text = [
      "import { eeRoutes } from '@/edition/ee-entry';",
      "import thing from '@/eel/thing';",
      "import like from './ee-like';",
      "import also from '../ee-like';",
    ].join('\n');
    expect(findViolations(path.join(SRC, 'pages/X.tsx'), text)).toEqual([]);
  });

  // Reads every source file of the app, tests included.
  it('imports nothing from src/ee beyond the baseline', { timeout: 30_000 }, () => {
    const allowed = new Set(readBaseline());
    const extra = walkViolations()
      .map((v) => `${v.file}|${v.specifier}`)
      .filter((key) => !allowed.has(key));
    expect(extra).toEqual([]);
  });

  it('lists in the baseline only imports the code still has', { timeout: 30_000 }, () => {
    const current = new Set(walkViolations().map((v) => `${v.file}|${v.specifier}`));
    expect(readBaseline().filter((key) => !current.has(key))).toEqual([]);
  });

  it('keeps the baseline sorted, unique, LF-terminated', () => {
    const raw = fs.readFileSync(BASELINE, 'utf8');
    const entries = JSON.parse(raw) as string[];
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.every((e) => typeof e === 'string' && /^[^|]+\|[^|]+$/.test(e))).toBe(true);
    expect(entries).toEqual([...entries].sort());
    expect(new Set(entries).size).toBe(entries.length);
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).not.toContain('\r');
  });
});
