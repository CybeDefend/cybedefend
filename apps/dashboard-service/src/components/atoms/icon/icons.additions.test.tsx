import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import * as icons from './icons';

/**
 * The glyphs the zinc kit draws with (galaxy orbit,
 * radar sweep, keyboard shortcuts, the highlights reel's play/pause, the
 * satellites of a project, the refused guard). They come from lucide through
 * the registry like every other one, so every glyph of the kit is stroked;
 * `icons.test.tsx` still guards the registry as a whole.
 */
const ADDED = ['Keyboard', 'Orbit', 'Pause', 'Play', 'Radar', 'Satellite', 'ShieldX'] as const;

/** The registry's selector for a name: `ShieldX` → `cybe-icon-shield-x`. */
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

describe('icons added for the zinc kit', () => {
  it.each(ADDED)('exports %s as a registry glyph with its kebab selector', (name) => {
    const Icon = (icons as Record<string, unknown>)[name] as React.ComponentType<icons.IconProps>;
    expect(Icon, `${name} is not exported by the registry`).toBeDefined();
    const { container } = render(<Icon size={17} className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain(`cybe-icon-${kebab(name)}`);
    expect(svg?.getAttribute('class')).toContain('h-4 w-4');
    expect(svg?.getAttribute('height')).toBe('17');
  });

  it('keeps the lucide import block and the lucide exports in alphabetical order', () => {
    const source = fs.readFileSync(path.join(__dirname, 'icons.tsx'), 'utf8');
    const block = source.match(/import \{([^}]*)\} from 'lucide-react'/)?.[1] ?? '';
    const imported = [...block.matchAll(/(\w+) as Lucide\w+/g)].map((m) => m[1]);
    const exported = [...source.matchAll(/export const (\w+) = createLucideIcon/g)].map((m) => m[1]);
    const sorted = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, 'en'));
    for (const name of ADDED) {
      expect(imported).toContain(name);
      expect(exported).toContain(name);
    }
    expect(imported).toEqual(sorted(imported));
    expect(exported.filter((n) => (ADDED as readonly string[]).includes(n))).toEqual(sorted([...ADDED]));
  });
});
