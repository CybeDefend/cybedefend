import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldServeSwagger } from './swagger-exposure';

/**
 * The Community edition in production does not mount the Swagger UI and its
 * document (`/api`, `/api-json`): an instance on the internet would publish
 * its whole route map. Every other case keeps today's behaviour (the cloud
 * and enterprise cases are tested with the cloud edition).
 */
describe('shouldServeSwagger', () => {
  const saved = process.env.CYBEDEFEND_EDITION;
  afterEach(() => {
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  });

  it.each([
    ['community', 'production', false],
    ['community', 'development', true],
    ['community', undefined, true],
  ])('edition %s, NODE_ENV %s → %s', (edition, nodeEnv, expected) => {
    if (edition === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = edition;
    expect(shouldServeSwagger(nodeEnv)).toBe(expected);
  });

  it('gates the only SwaggerModule.setup of main.ts', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    const setups = main.match(/SwaggerModule\.setup\(/g) ?? [];
    expect(setups).toHaveLength(1);
    const gate = main.indexOf('if (shouldServeSwagger(process.env.NODE_ENV))');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(main.indexOf('SwaggerModule.setup('));
    expect(gate).toBeLessThan(main.indexOf('SwaggerModule.createDocument('));
  });
});
