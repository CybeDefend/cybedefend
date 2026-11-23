import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTS } from '@/utils/product';

/**
 * A project page of a product is reached through `projectPath(product,
 * projectId, segment)` (`utils/product.ts`), the one seam a change of prefix
 * or a per-product entitlement guard will use. A URL written by hand, a
 * template `/<space>/project/${id}/…`, matches the route the day it is
 * written and is skipped by the next change. The route tables and the redirects of the former URLs
 * write patterns (`:projectId`), never a template, so they pass.
 */
const SRC = path.resolve(__dirname, '..');
const HAND_BUILT = new RegExp(`\`\\/(?:${PRODUCTS.join('|')})\\/project\\/\\$\\{`, 'g');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('product project URLs', () => {
  it('are built with projectPath, never written by hand', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => (fs.readFileSync(file, 'utf8').match(HAND_BUILT)?.length ?? 0) > 0)
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
