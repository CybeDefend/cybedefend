import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { DiscoveryModule } from './discovery.module';
import { ToolRegistry } from '../mcp/tools/registry';
import { SESSION_STORE } from '../mcp/session/session-store.interface';
import { InMemorySessionStore } from '../mcp/session/session.store';
import { MCP_EDITION_TEXTS } from '../../edition/ports/mcp-edition-texts.port';
import { COMMUNITY_MCP_EDITION_TEXTS } from '../../edition/community/mcp-edition-texts.community';

/** The edition texts `create_project` reads, bound to the community values. */
@Global()
@Module({
  providers: [
    { provide: MCP_EDITION_TEXTS, useValue: COMMUNITY_MCP_EDITION_TEXTS },
  ],
  exports: [MCP_EDITION_TEXTS],
})
class EditionTextsModule {}

/**
 * Module-level integration spec for {@link DiscoveryModule}. Stands up a
 * real Nest DI graph so `onModuleInit` fires, then verifies both project-
 * discovery tools end up in the shared {@link ToolRegistry}. Mirrors the
 * pattern used by `overview.module.spec.ts`.
 */
describe('DiscoveryModule', () => {
  let sessionStore: InMemorySessionStore;
  let registry: ToolRegistry;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({ CYBEDEFEND_API_RESOURCE: 'http://gateway.test.local' }),
          ],
        }),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        EditionTextsModule,
        DiscoveryModule,
      ],
    }).compile();

    registry = moduleRef.get(ToolRegistry);
    sessionStore = moduleRef.get<InMemorySessionStore>(SESSION_STORE);
    await moduleRef.init();
  });

  afterEach(() => {
    sessionStore.stop();
  });

  it('registers the discovery tools after init', () => {
    const names = registry.all().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_organizations',
        'search_projects',
        'list_teams',
        'create_project',
      ]),
    );
  });
});
