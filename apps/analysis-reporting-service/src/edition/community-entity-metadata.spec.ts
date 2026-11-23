import type { Type } from '@nestjs/common';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

// In the private repository the edition files still import the closed modules
// (src/ee/), and importing app.module runs their forFeature() calls whatever
// the edition. The export replaces those files with the Community overlays: use
// the overlays here when they exist, so this spec checks the same entity set in
// both trees (in the export the files already are the overlays). The overlays
// sit outside the service, where ts-jest cannot resolve their type imports:
// they are transpiled without a type check and loaded by Node itself.
const EDITION_OVERLAYS = join(
  __dirname,
  '../../../../opencore/overlay/apps/analysis-reporting-service/src/edition',
);
const OVERLAID_EDITION_FILES = [
  'edition',
  'ee-modules',
  'ee-migrations',
  'ee-secrets',
];

function useCommunityEditionOverlays(): string | undefined {
  const present = OVERLAID_EDITION_FILES.filter((name) =>
    existsSync(join(EDITION_OVERLAYS, `${name}.ts`)),
  );
  if (present.length === 0) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'ar-edition-overlays-'));
  for (const name of present) {
    const source = readFileSync(join(EDITION_OVERLAYS, `${name}.ts`), 'utf8');
    const { outputText } = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.CommonJS,
        target: ScriptTarget.ES2021,
      },
    });
    writeFileSync(join(dir, `${name}.js`), outputText);
  }
  const nodeRequire = createRequire(join(dir, 'index.js'));
  for (const name of present) {
    jest.doMock(`./${name}`, () => nodeRequire(`./${name}.js`));
  }
  return dir;
}

/**
 * The API context loads its entities with `autoLoadEntities`: TypeORM sees
 * only the entities some imported module registers with
 * `TypeOrmModule.forFeature`. Outside the Community Edition, the closed OSV
 * sync module
 * registers every OSV entity; the Community Edition does not load it, so a
 * relation whose target nobody registers fails at boot with « Entity
 * metadata for VulnerabilityOsvAffected#ranges was not found ». The
 * community-boot
 * spec compiles in preview mode, which never builds the entity metadata, so
 * it could not see this.
 */
describe('AppModule in community mode: the auto-loaded entities', () => {
  const savedEnv = process.env;
  let overlayDir: string | undefined;

  beforeAll(() => {
    // ConfigModule.forRoot validates the environment when AppModule is
    // imported: placeholders, nothing connects.
    process.env = {
      ...savedEnv,
      NODE_ENV: 'development',
      // The compose runs every database service on PostgreSQL; column types
      // are resolved from DB_TYPE when the entity decorators are evaluated.
      DB_TYPE: 'postgres',
      GRPC_URL_ANALYSIS_REPORTING_SERVICE: '127.0.0.1:1',
      GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
      GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
      REDIS_URL: 'redis://127.0.0.1:1',
      OTEL_DISABLED: 'true',
      CYBEDEFEND_EDITION: 'community',
    };
  });

  afterAll(() => {
    process.env = savedEnv;
    if (overlayDir) rmSync(overlayDir, { recursive: true, force: true });
  });

  it('build their TypeORM metadata, every relation target included', async () => {
    overlayDir = useCommunityEditionOverlays();
    // Importing AppModule evaluates every forFeature() of its graph, which
    // records the entities against the default data source.
    await import('../app.module');
    // Not exported by @nestjs/typeorm, whose package exports refuse a deep
    // import: load the file the package itself imports, by its resolved path.
    const typeormDir = join(
      require.resolve('@nestjs/typeorm/package.json'),
      '..',
    );
    const { EntitiesMetadataStorage } = await import(
      join(typeormDir, 'dist/entities-metadata.storage.js')
    );
    const { DataSource } = await import('typeorm');
    const entities = EntitiesMetadataStorage.getEntitiesByDataSource(
      'default',
    ) as Array<Type<unknown>>;
    expect(entities.length).toBeGreaterThan(0);

    const dataSource = new DataSource({
      type: 'postgres',
      entities,
    });
    await expect(
      (
        dataSource as unknown as { buildMetadatas(): Promise<void> }
      ).buildMetadatas(),
    ).resolves.toBeUndefined();
  });
});
