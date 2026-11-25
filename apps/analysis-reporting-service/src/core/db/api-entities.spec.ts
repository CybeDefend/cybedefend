import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The API process is the one context that does not find its entities by file
 * name: its data source knows only the entities a `TypeOrmModule.forFeature`
 * of its module graph registers (`autoLoadEntities`, see `typeorm-options.ts`).
 * The workers, the crons and the live specs use a file glob, so an entity the
 * API code reads but no module registers passes every one of them and fails
 * only in the running API, on the first query, with « No metadata for … was
 * found ».
 *
 * So every entity of `src/entities` must be registered in the API module
 * graph. Resolving that graph in preview mode instantiates nothing and opens
 * no connection.
 */

// What the Joi schema requires. Placeholders: nothing connects.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_AGENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_BILLING_SERVICE: '127.0.0.1:1',
  REDIS_URL: 'redis://127.0.0.1:1',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
};

const ENTITIES_DIR = join(__dirname, '..', '..', 'entities');

/** Every `*.entity.ts` file under `dir`, at any depth. */
function entityFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entityFiles(path);
    return entry.name.endsWith('.entity.ts') ? [path] : [];
  });
}

interface ModuleInGraph {
  providers: Map<unknown, unknown>;
}

describe('the entities of the API process', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it('registers every entity of src/entities', async () => {
    const { Test } = await import('@nestjs/testing');
    const { getRepositoryToken } = await import('@nestjs/typeorm');
    const { getMetadataArgsStorage } = await import('typeorm');
    const { AppModule } = await import('../../app.module');

    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile({ preview: true });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const provided = new Set<unknown>();
    for (const module of container.getModules().values()) {
      for (const token of module.providers.keys()) provided.add(token);
    }

    // The classes the entity files export that carry an @Entity table. Every
    // file is loaded first: a table is known only once its class is defined.
    const exportedValues: unknown[] = [];
    for (const file of entityFiles(ENTITIES_DIR)) {
      const exported = (await import(file)) as Record<string, unknown>;
      exportedValues.push(...Object.values(exported));
    }
    const tables = new Set<unknown>(
      getMetadataArgsStorage().tables.map((table) => table.target),
    );
    const entities = new Map<string, new () => unknown>();
    for (const value of exportedValues) {
      if (typeof value === 'function' && tables.has(value)) {
        entities.set(value.name, value as new () => unknown);
      }
    }

    // Guards the guard: the folder and the module graph were really read.
    expect(entities.size).toBeGreaterThan(20);

    const unregistered = [...entities.values()]
      .filter((entity) => !provided.has(getRepositoryToken(entity)))
      .map((entity) => entity.name)
      .sort();
    expect(unregistered).toEqual([]);
    await app.close();
  }, 120_000);
});
