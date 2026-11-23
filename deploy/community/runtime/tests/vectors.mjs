// Finds libs/test-fixtures/secrets/hkdf-vectors.json by walking up from this
// directory, so the tests run wherever deploy/community sits under the tree.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELATIVE = join('libs', 'test-fixtures', 'secrets', 'hkdf-vectors.json');

export function loadVectors() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, RELATIVE);
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${RELATIVE} not found above ${dirname(fileURLToPath(import.meta.url))}`);
    dir = parent;
  }
}
