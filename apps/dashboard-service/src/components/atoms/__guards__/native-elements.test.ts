import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NATIVE_ELEMENT_DEBT, isAtomPath } from './native-elements';

/**
 * The design system only works if it is the single way to render a control.
 * A hand-rolled `<button className="...">` looks right on the day it is written
 * and then drifts: it misses the focus ring, the disabled state, the loading
 * spinner and the dark-mode tokens that `<Button>` gets for free, and no change
 * to the atom ever reaches it.
 *
 * 499 such elements exist today. Rather than block on migrating them all, this
 * test freezes the debt per file: counts may shrink, never grow, and a file not
 * already in the list may not introduce any. New code therefore has no choice
 * but to use the atoms.
 */
const SRC = path.resolve(__dirname, '../../..');
const TAGS = ['button', 'input', 'select', 'textarea'] as const;

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

/** Native elements in a file — atoms themselves are where the native tag belongs. */
function countNative(file: string, rel: string): number {
  if (isAtomPath(`src/${rel}`)) return 0;
  const text = fs.readFileSync(file, 'utf8');
  return TAGS.reduce((n, tag) => n + (text.match(new RegExp(`<${tag}[\\s>/]`, 'g'))?.length ?? 0), 0);
}

describe('design system', () => {
  it('allows native elements in an ee atom', () => {
    expect(isAtomPath('src/ee/area/components/atoms/x/X.tsx')).toBe(true);
    expect(isAtomPath('src/components/atoms/zinc/button/Button.tsx')).toBe(true);
    expect(isAtomPath('src/components/molecules/sidebar/Sidebar.tsx')).toBe(false);
  });

  it('never adds a native control outside the atoms', () => {
    // The closed extension tree's own debt is listed with it, when that tree is there.
    const eeDebtFile = path.join(SRC, 'ee/native-elements.debt.json');
    const eeDebt: Array<[string, number]> = fs.existsSync(eeDebtFile) ? JSON.parse(fs.readFileSync(eeDebtFile, 'utf8')) : [];
    const budget = new Map([...NATIVE_ELEMENT_DEBT, ...eeDebt].map(([file, n]) => [file, n]));
    const regressions: string[] = [];
    const paidOff: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const key = `src/${rel}`;
      const actual = countNative(file, rel);
      const allowed = budget.get(key) ?? 0;

      if (actual > allowed) {
        regressions.push(
          allowed === 0
            ? `${key} — ${actual} native control(s); use the atoms in src/components/atoms`
            : `${key} — ${actual} native control(s), budget is ${allowed}`,
        );
      } else if (actual < allowed) {
        paidOff.push(`${key} — ${allowed} → ${actual}`);
      }
      budget.delete(key);
    }

    // A file listed but gone (renamed, deleted) is stale debt: same fix, drop it.
    for (const [key] of budget) paidOff.push(`${key} — file no longer exists`);

    expect(
      regressions,
      `native controls added outside the design system:\n${regressions.join('\n')}`,
    ).toEqual([]);

    expect(
      paidOff,
      `debt paid off — update NATIVE_ELEMENT_DEBT so the ratchet holds:\n${paidOff.join('\n')}`,
    ).toEqual([]);
  });
});
