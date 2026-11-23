import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * @cybedefend/deepfix (the closed autofix library) is a private package. The export
 * drops it from package.json and pnpm-lock.yaml, so no file of the
 * exported tree may name it: every import of it lives under src/ee/. Specs
 * are included, since a jest.mock of the package names it too.
 */
const PRIVATE_PACKAGE = /['"]@cybedefend\/deepfix['"]/;

describe('private packages', () => {
  it('no file outside src/ee imports @cybedefend/deepfix', () => {
    const src = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full === join(src, 'ee')) continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (PRIVATE_PACKAGE.test(readFileSync(full, 'utf8'))) {
            offenders.push(relative(src, full));
          }
        }
      }
    };
    walk(src);
    expect(offenders.sort()).toEqual([]);
  });
});
