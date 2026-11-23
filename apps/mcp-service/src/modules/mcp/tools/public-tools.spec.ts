import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';

import { ToolRegistry } from './registry';
import { SESSION_STORE } from '../session/session-store.interface';
import { InMemorySessionStore } from '../session/session.store';

import { OverviewModule } from '../../overview/overview.module';
import { DiscoveryModule } from '../../discovery/discovery.module';
import { SastModule } from '../../sast/sast.module';
import { ScaModule } from '../../sca/sca.module';
import { IacModule } from '../../iac/iac.module';
import { CicdModule } from '../../cicd/cicd.module';
import { SecretModule } from '../../secret/secret.module';
import { ContainerModule } from '../../container/container.module';
import { VulnerabilitiesModule } from '../../vulnerabilities/vulnerabilities.module';
import { PostureModule } from '../../posture/posture.module';
import { MCP_EDITION_TEXTS } from '../../../edition/ports/mcp-edition-texts.port';
import { COMMUNITY_MCP_EDITION_TEXTS } from '../../../edition/community/mcp-edition-texts.community';

/** The edition texts the discovery tools read, bound to the community values. */
@Global()
@Module({
  providers: [
    { provide: MCP_EDITION_TEXTS, useValue: COMMUNITY_MCP_EDITION_TEXTS },
  ],
  exports: [MCP_EDITION_TEXTS],
})
class EditionTextsModule {}

/**
 * Contract test for the public `/mcp` surface — the single audience
 * (there is no internal surface). Boots the full module graph so a missing import
 * or a mistaken registration fails loudly.
 */
describe('Public MCP tool registry — full composition', () => {
  let sessionStore: InMemorySessionStore;
  let publicRegistry: ToolRegistry;

  const expectedPublicTools = [
    'get_project_overview',
    'get_branches',
    'list_vulnerabilities_sast',
    'get_vulnerability_sast',
    'list_vulnerabilities_sca',
    'get_vulnerability_sca',
    'list_vulnerabilities_iac',
    'get_vulnerability_iac',
    'list_vulnerabilities_cicd',
    'get_vulnerability_cicd',
    'list_vulnerabilities_secret',
    'get_vulnerability_secret',
    'list_vulnerabilities_container',
    'get_vulnerability_container',
    'update_vulnerability',
    'set_exploitability',
    'list_organizations',
    'search_projects',
    'list_teams',
    'create_project',
    'get_user_posture',
  ];

  const expectedProjectIdRequired = new Set([
    'get_project_overview',
    'get_branches',
    'get_vulnerability_sast',
    'list_vulnerabilities_sast',
    'get_vulnerability_sca',
    'list_vulnerabilities_sca',
    'get_vulnerability_iac',
    'list_vulnerabilities_iac',
    'get_vulnerability_cicd',
    'list_vulnerabilities_cicd',
    'get_vulnerability_secret',
    'list_vulnerabilities_secret',
    'get_vulnerability_container',
    'list_vulnerabilities_container',
    'update_vulnerability',
    'set_exploitability',
  ]);

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
        OverviewModule,
        DiscoveryModule,
        SastModule,
        ScaModule,
        IacModule,
        CicdModule,
        SecretModule,
        ContainerModule,
        VulnerabilitiesModule,
        PostureModule,
      ],
    }).compile();

    publicRegistry = moduleRef.get(ToolRegistry);
    sessionStore = moduleRef.get<InMemorySessionStore>(SESSION_STORE);
    await moduleRef.init();
  });

  afterEach(() => {
    sessionStore.stop();
  });

  it(`registers exactly ${expectedPublicTools.length} tools on the public surface`, () => {
    expect(publicRegistry.all()).toHaveLength(expectedPublicTools.length);
  });

  it('registers every expected canonical tool name on the public surface', () => {
    const names = publicRegistry
      .all()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([...expectedPublicTools].sort());
  });

  it('does not register the removed scan tools', () => {
    const names = publicRegistry.all().map((t) => t.name);
    expect(names).not.toContain('start_scan');
    expect(names).not.toContain('cancel_scan');
  });

  it('does not register the tools removed for response-size reduction', () => {
    const names = publicRegistry.all().map((t) => t.name);
    expect(names).not.toContain('list_sca_packages');
    expect(names).not.toContain('get_similar_vulnerabilities');
  });

  it('each public tool advertises a JSON schema with type=object', () => {
    for (const tool of publicRegistry.all()) {
      expect((tool.inputSchema as { type: string }).type).toBe('object');
    }
  });

  it('every project-scoped tool requires projectId on the public surface', () => {
    for (const tool of publicRegistry.all()) {
      if (!expectedProjectIdRequired.has(tool.name)) continue;
      const schema = tool.inputSchema as { required?: string[] };
      expect(schema.required ?? []).toEqual(
        expect.arrayContaining(['projectId']),
      );
    }
  });

  it('search_projects requires organizationId on the public surface', () => {
    const tool = publicRegistry.all().find((t) => t.name === 'search_projects');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['organizationId']));
  });

  it('create_project requires its confirmation flag on the public surface', () => {
    const tool = publicRegistry.all().find((t) => t.name === 'create_project');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { required?: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(['organizationId', 'name', 'confirmed_by_user']),
    );
  });

  it('get_user_posture requires organizationId on the public surface', () => {
    const tool = publicRegistry
      .all()
      .find((t) => t.name === 'get_user_posture');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['organizationId']));
  });
});
