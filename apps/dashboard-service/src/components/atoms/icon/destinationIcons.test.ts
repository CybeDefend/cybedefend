import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { Building, FileAlt, Home, ShieldHalved, WandMagicSparkles } from '@/components/atoms/icon/icons';
import { DESTINATION_ICONS, destinationIcon } from './destinationIcons';

describe('destinationIcons', () => {
  it('is keyed by the routes of the destinations, AppSec ones under /appsec', () => {
    expect(DESTINATION_ICONS).toEqual({
      '/appsec': Home,
      '/appsec/organization/overview': Building,
      '/appsec/autofix': WandMagicSparkles,
      '/appsec/reports': FileAlt,
      '/organization/settings/policies': ShieldHalved,
    });
  });

  it.each([
    ['/appsec', Home],
    ['/appsec/organization/overview', Building],
    ['/appsec/autofix', WandMagicSparkles],
    ['/appsec/reports', FileAlt],
    ['/organization/settings/policies', ShieldHalved],
  ])('names the glyph of %s', (route, icon) => {
    expect(destinationIcon(route)).toBe(icon);
  });

  // A caller written before AppSec had its prefix names the same destination.
  it.each([
    ['/', Home],
    ['/organization/overview', Building],
    ['/autofix', WandMagicSparkles],
    ['/reports', FileAlt],
  ])('gives the former AppSec route %s the same glyph', (route, icon) => {
    expect(destinationIcon(route)).toBe(icon);
  });

  it('falls back to the dashboard glyph for a route with no entry', () => {
    expect(destinationIcon('/nowhere')).toBe(Home);
  });
});

/**
 * The fallback above serves callers written before AppSec had its prefix. A
 * caller names its destination as the URL contract writes it — through
 * `productHome` / `appsecPath`, or by a literal route that is itself a key —
 * so a glyph never depends on the fallback guessing the page.
 */
describe('destinationIcon callers', () => {
  const SRC = path.resolve(__dirname, '../../..');

  const sources = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
    });

  it('name every literal route as a key of DESTINATION_ICONS', () => {
    const unkeyed = sources(SRC).flatMap((file) =>
      Array.from(fs.readFileSync(file, 'utf8').matchAll(/destinationIcon\(\s*(['"`])([^'"`]*)\1\s*\)/g))
        .map((match) => match[2])
        .filter((route) => !(route in DESTINATION_ICONS))
        .map((route) => `${path.relative(SRC, file)}: ${route}`),
    );
    expect(unkeyed).toEqual([]);
  });
});
