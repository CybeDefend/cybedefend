import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';

/**
 * The API context loads its entities with autoLoadEntities: only the entities
 * a TypeOrmModule.forFeature of its module graph registers. In the Community
 * Edition no closed module is in that graph, so every relation of a
 * registered entity must point to another registered entity, or TypeORM
 * refuses to start: G7 died on « Entity metadata for
 * VulnerabilityOsvAffected#ranges was not found », the OSV children being
 * registered by the closed OsvSyncModule only.
 *
 * The graph is the one community-boot.spec.ts compiles (preview: nothing
 * connects). Not EntitiesMetadataStorage: ee-modules.ts still imports the
 * closed modules in the private tree, and their forFeature calls fill it.
 */
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

interface ModuleInGraph {
  providers: Map<unknown, unknown>;
}

describe('AppModule in community mode', () => {
  const savedEnv = process.env;
  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  it('registers every entity the relations of its registered entities point to', async () => {
    const { AppModule } = (await import('../app.module')) as {
      AppModule: Type<unknown>;
    };
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile({ preview: true });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    // A forFeature repository's token is `<EntityName>Repository`.
    const tokens = new Set<string>();
    for (const m of container.getModules().values()) {
      for (const token of m.providers.keys()) {
        if (typeof token === 'string' && token.endsWith('Repository')) {
          tokens.add(token.slice(0, -'Repository'.length));
        }
      }
    }
    const entities = getMetadataArgsStorage().tables.map(
      (t) => t.target as { name: string },
    );
    const registered = new Set(entities.filter((e) => tokens.has(e.name)));
    expect(registered.size).toBeGreaterThan(10);

    const dangling: string[] = [];
    for (const rel of getMetadataArgsStorage().relations) {
      if (!registered.has(rel.target as { name: string })) continue;
      // rel.type is a thunk (() => Entity, no prototype) or the class itself.
      const target =
        typeof rel.type === 'function' && rel.type.prototype === undefined
          ? (rel.type as () => unknown)()
          : rel.type;
      if (typeof target === 'function' && !registered.has(target as never)) {
        dangling.push(
          `${(rel.target as { name: string }).name}#${rel.propertyName}`,
        );
      }
    }
    expect(dangling.sort()).toEqual([]);
  }, 120_000);
});
