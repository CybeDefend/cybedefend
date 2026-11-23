import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import * as icons from './icons';

const SRC = path.resolve(__dirname, '../../..');
const REGISTRY_DIR = path.resolve(SRC, 'components/atoms/icon');

/**
 * The icon vendors are FontAwesome (solid + brands) and lucide, reached only
 * through this registry. `react-icons` is allowed too, and only for trademarked
 * brand marks — package ecosystems (npm, PyPI, Maven…), languages, GitLab.
 */
const BRAND_ONLY = 'react-icons';
const VENDOR_MODULES = /^(lucide-react|@fortawesome\/)/;
const BRAND_PREFIX = /^(Si|Fa)[A-Z]/;
/** The in-house set this registry was rolled back off, relative spellings included. */
const RETIRED_IN_HOUSE = /(^|\/)cybe(\/|$)|cybe-icons/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Matches `import {…} from 'mod'` and `export {…} from 'mod'` alike — a re-export
 * pulls a vendor into the bundle just as an import does.
 */
const IMPORT_RE = /(?:import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gs;

/** Every exported icon component, `IconProps` (a type) excluded. */
const iconEntries = Object.entries(icons).filter(
  ([, value]) => typeof value === 'object' || typeof value === 'function',
) as [string, React.ComponentType<icons.IconProps>][];

describe('icon registry', () => {
  it('exports the whole set as renderable components', () => {
    expect(iconEntries.length).toBeGreaterThan(200);

    for (const [name, Icon] of iconEntries) {
      const { container, unmount } = render(<Icon className="test-icon" />);
      const svg = container.querySelector('svg');
      expect(svg, `${name} did not render an <svg>`).not.toBeNull();
      expect(svg?.getAttribute('class'), `${name} dropped className`).toContain('test-icon');
      unmount();
    }
  });

  it('accepts the size prop every call site passes', () => {
    for (const name of ['Bug', 'ChevronDown', 'Github', 'X', 'Times'] as const) {
      const Icon = icons[name] as React.ComponentType<icons.IconProps>;
      const { container, unmount } = render(<Icon size={17} strokeWidth={1.5} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('height'), `${name} ignored size`).toBe('17');
      unmount();
    }
  });

  it('no longer draws any icon from the retired in-house set', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (file === __filename) continue;
      for (const [, , mod] of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
        if (RETIRED_IN_HOUSE.test(mod)) offenders.push(`${path.relative(SRC, file)} → ${mod}`);
      }
    }

    expect(
      offenders,
      `the in-house icon set is retired, import from the registry instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the registry the single door onto the icon vendors', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (file.startsWith(REGISTRY_DIR)) continue;
      for (const [, , mod] of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
        if (VENDOR_MODULES.test(mod)) offenders.push(`${path.relative(SRC, file)} → ${mod}`);
      }
    }

    expect(
      offenders,
      `icon vendors are imported through the registry only:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('uses react-icons only for brand marks', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (file === __filename) continue;
      for (const [, names, mod] of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
        if (!mod.startsWith(BRAND_ONLY)) continue;
        for (const raw of names.split(',')) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          // IconType is react-icons' own prop type, not a glyph.
          if (!name || name === 'IconType' || BRAND_PREFIX.test(name)) continue;
          offenders.push(`${path.relative(SRC, file)} → ${name} (${mod})`);
        }
      }
    }

    expect(
      offenders,
      `non-brand icons imported from react-icons:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
