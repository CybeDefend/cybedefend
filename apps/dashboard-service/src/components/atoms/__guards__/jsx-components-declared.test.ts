import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * A JSX tag whose component is neither imported nor declared in its file is a
 * `ReferenceError` the first time React renders it, and the build lets it
 * through: Vite strips types without checking them, and `tsc` already reports
 * hundreds of older errors nobody reads.
 *
 * It can take the whole dashboard down. A branch once added
 * `<Layout currentPath="…">` to `App.tsx`, written when the routes still
 * used `Layout`; `dev` had moved them to
 * `ShellPage` and dropped the import. The merge raised no conflict, and since
 * `App` builds every route element when it renders, every page fell into the
 * crash page (`ReferenceError: Layout is not defined`).
 *
 * The check is per file and syntactic: a tag (or the root of `Foo.Bar`) that
 * starts with a capital must be bound somewhere in its file (an import, a
 * declaration, a parameter, a destructured name).
 */
const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, acc);
    } else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\./.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** `file:line <Tag>` for every capitalised JSX tag the file never binds. */
function undeclaredComponents(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bound = new Set<string>();
  const used: Array<{ name: string; line: number }> = [];

  const bind = (name: ts.BindingName | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) bound.add(name.text);
    else name.elements.forEach((e) => ts.isBindingElement(e) && bind(e.name));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportClause(node) && node.name) bound.add(node.name.text);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) {
      bound.add(node.name.text);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name
    ) {
      bound.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) bind(node.name);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let tag: ts.JsxTagNameExpression = node.tagName;
      while (ts.isPropertyAccessExpression(tag)) tag = tag.expression as ts.JsxTagNameExpression;
      if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) {
        used.push({ name: tag.text, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return used.filter((u) => !bound.has(u.name)).map((u) => `${fileName}:${u.line} <${u.name}>`);
}

describe('JSX components', () => {
  it('flags a tag its file neither imports nor declares', () => {
    const text = [
      "import ShellPage from './ShellPage';",
      'export const routes = (',
      '  <ShellPage>',
      '    <Layout currentPath="Settings" />',
      '  </ShellPage>',
      ');',
    ].join('\n');
    expect(undeclaredComponents('App.tsx', text)).toEqual(['App.tsx:4 <Layout>']);
  });

  it('accepts imported, declared, parameter and member tags', () => {
    const text = [
      "import * as Icons from './icons';",
      "import Card, { Row } from './card';",
      'function Local() { return null; }',
      'export function View({ Item }: { Item: () => null }) {',
      '  const Tag = Row;',
      '  return <Card><Row /><Tag /><Item /><Local /><Icons.Check /><div /></Card>;',
      '}',
    ].join('\n');
    expect(undeclaredComponents('View.tsx', text)).toEqual([]);
  });

  // Reads every source file of the app: it grows with the codebase, and took 5.66 s once under load.
  it('never renders a component its file does not bind', { timeout: 30_000 }, () => {
    const missing = sourceFiles(SRC).flatMap((file) =>
      undeclaredComponents(`src/${path.relative(SRC, file).split(path.sep).join('/')}`, fs.readFileSync(file, 'utf8')),
    );
    expect(missing).toEqual([]);
  });
});
