import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The SDK only patches what is required after it starts, so it must start
 * before Fastify, Nest and ioredis are loaded (started in bootstrap(), it
 * recorded no HTTP server span and no Redis span).
 * `test/e2e/tracing.e2e.spec.ts` checks the outcome; these pin the wiring,
 * which an import sorter or a rewritten entrypoint could undo silently.
 */
const ROOT = join(__dirname, '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf-8');

describe('the OpenTelemetry SDK starts before anything it instruments', () => {
  it('is preloaded by the image', () => {
    expect(read('entrypoint.sh')).toMatch(
      /^exec node --require \.\/dist\/instrumentation\.js dist\/main$/m,
    );
  });

  it('is preloaded by start:prod', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['start:prod']).toBe(
      'node --require ./dist/instrumentation.js dist/main',
    );
  });

  it('is the first import of main.ts (nest start, local runs)', () => {
    const firstImport = read('src/main.ts')
      .split('\n')
      .find((line) => line.startsWith('import '));
    expect(firstImport).toBe("import './instrumentation';");
  });
});
