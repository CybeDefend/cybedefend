/* eslint-disable @typescript-eslint/no-require-imports -- AppModule and the
   files it loads must be required inside jest.isolateModules, after
   CYBEDEFEND_EDITION is set: a static import would test the cloud graph. */
import type { Type } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';

import { MCP_EDITION_TEXTS } from './ports/mcp-edition-texts.port';
import {
  UNTRUSTED_FINDING_TEXT,
  UUID_PATTERN,
} from '../modules/mcp/tools/schema-parts';
import type { McpEditionTexts } from './ports/mcp-edition-texts.port';
import { InMemorySessionStore } from '../modules/mcp/session/session.store';
import { SESSION_STORE } from '../modules/mcp/session/session-store.interface';

/**
 * The tools and prompts the Community Edition serves, read from the registries of the
 * real AppModule once every `onModuleInit` has run (not preview mode: the
 * feature modules register their tools there).
 *
 * editionImports() runs when the @Module decorator of AppModule is evaluated,
 * i.e. at import time, so CYBEDEFEND_EDITION is set first and AppModule is
 * required inside jest.isolateModules.
 *
 * The cloud case is tested by the cloud edition.
 */

// `jose@6` ships only as native ESM, which Jest's CJS runtime cannot load.
// AuthGuard builds its JWKS set lazily, so a stub is enough (the same stub as
// test/e2e/mcp.e2e-spec.ts).
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

// The community environment: no Logto and no cloud secrets key. Placeholders:
// nothing connects. REDIS_URL is left unset.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '3010',
  PUBLIC_URL: 'http://localhost:3010',
  CYBEDEFEND_API_RESOURCE: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:3002',
  OTEL_DISABLED: 'true',
};

/** The 21 AppSec tools of the core. */
const COMMUNITY_TOOLS = [
  'list_organizations',
  'search_projects',
  'list_teams',
  'create_project',
  'get_project_overview',
  'get_branches',
  'get_user_posture',
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
];

/** The 17 closed tools. */
const CLOSED_TOOLS = [
  'cybe_guards_list',
  'cybe_guards_check',
  'cybe_guards_record_violation',
  'cybe_rules_fetch',
  'cybe_rules_list',
  'cybe_rules_report_missing',
  'cybe_rules_record_violation',
  'cybe_rules_list_proposals',
  'cybe_rules_accept_proposal',
  'cybe_rules_reject_proposal',
  'cybe_rules_edit',
  'cybe_rules_delete',
  'cybe_scan_diff',
  'cybe_scan_status',
  'cybe_scan_findings',
  'cybe_secrules_fetch',
  'search_documentation',
];

/** The tools that change data; every other one only reads. */
const WRITE_TOOLS: Record<string, { destructiveHint: boolean }> = {
  create_project: { destructiveHint: false },
  // Changing a finding's state can hide a real vulnerability: clients
  // should ask the user first.
  update_vulnerability: { destructiveHint: true },
  set_exploitability: { destructiveHint: true },
};

interface Named {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { pattern?: string }> };
  annotations?: Record<string, unknown>;
}

interface Booted {
  moduleRef: TestingModule;
  tools: string[];
  prompts: string[];
  definitions: Record<string, Named>;
}

const savedEnv = process.env;

async function boot(edition: string | undefined): Promise<Booted> {
  process.env = { ...savedEnv, ...BOOT_ENV };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('LOGTO_')) {
      delete process.env[key];
    }
  }
  if (edition) {
    process.env.CYBEDEFEND_EDITION = edition;
  } else {
    delete process.env.CYBEDEFEND_EDITION;
  }
  delete process.env.REDIS_URL;

  let compile: (() => Promise<TestingModule>) | undefined;
  let classes:
    | {
        toolRegistry: Type<{ all(): Named[] }>;
        promptRegistry: Type<{ all(): Named[] }>;
      }
    | undefined;
  jest.isolateModules(() => {
    const { AppModule } = require('../app.module') as {
      AppModule: Type<unknown>;
    };
    const { GatewayClientService } =
      require('../modules/gateway-client/gateway-client.service') as {
        GatewayClientService: Type<unknown>;
      };
    const { ToolRegistry } = require('../modules/mcp/tools/registry') as {
      ToolRegistry: Type<{ all(): Named[] }>;
    };
    const { PromptRegistry } = require('../modules/mcp/prompts/registry') as {
      PromptRegistry: Type<{ all(): Named[] }>;
    };
    const { Test } =
      require('@nestjs/testing') as typeof import('@nestjs/testing');
    classes = {
      toolRegistry: ToolRegistry,
      promptRegistry: PromptRegistry,
    };
    compile = () =>
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(GatewayClientService)
        .useValue({})
        .overrideProvider(SESSION_STORE)
        .useValue(store)
        .compile();
  });
  const moduleRef = await compile!();
  await moduleRef.init();
  const names = (registry: Type<{ all(): Named[] }>): string[] =>
    moduleRef
      .get(registry)
      .all()
      .map((entry) => entry.name);
  return {
    moduleRef,
    tools: names(classes!.toolRegistry),
    prompts: names(classes!.promptRegistry),
    definitions: Object.fromEntries(
      moduleRef
        .get(classes!.toolRegistry)
        .all()
        .map((tool) => [tool.name, tool]),
    ),
  };
}

let store: InMemorySessionStore;

describe('MCP tool registry in community mode', () => {
  let booted: Booted;

  beforeAll(async () => {
    store = new InMemorySessionStore();
    booted = await boot('community');
  }, 120_000);

  afterAll(async () => {
    process.env = savedEnv;
    await booted?.moduleRef.close();
    store.stop();
  });

  it('registers exactly the 21 AppSec tools', () => {
    expect([...booted.tools].sort()).toEqual([...COMMUNITY_TOOLS].sort());
  });

  it('registers no closed tool and no prompt', () => {
    for (const name of CLOSED_TOOLS) {
      expect(booted.tools).not.toContain(name);
    }
    expect(booted.prompts).toHaveLength(0);
  });

  it('annotates every tool: read-only ones as such, the ones that change a finding as destructive', () => {
    for (const name of COMMUNITY_TOOLS) {
      const hints = booted.definitions[name].annotations;
      const write = WRITE_TOOLS[name];
      expect({ name, readOnlyHint: hints?.readOnlyHint }).toEqual({
        name,
        readOnlyHint: !write,
      });
      if (write) {
        expect({ name, destructiveHint: hints?.destructiveHint }).toEqual({
          name,
          ...write,
        });
      }
    }
  });

  it('declares every id argument as a UUID, so a malformed id is refused before any permission check', () => {
    const ids = ['projectId', 'vulnerabilityId', 'organizationId', 'teamId'];
    let checked = 0;
    for (const name of COMMUNITY_TOOLS) {
      const properties = booted.definitions[name].inputSchema?.properties;
      for (const id of ids) {
        if (!properties?.[id]) continue;
        checked += 1;
        expect({ name, id, pattern: properties[id].pattern }).toEqual({
          name,
          id,
          pattern: UUID_PATTERN,
        });
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('tells the agent that finding text is untrusted data on every tool that returns it', () => {
    for (const name of COMMUNITY_TOOLS.filter((n) =>
      /^(list_vulnerabilities|get_vulnerability)_/.test(n),
    )) {
      expect({
        name,
        description: booted.definitions[name].description,
      }).toEqual({
        name,
        description: expect.stringContaining(UNTRUSTED_FINDING_TEXT),
      });
    }
  });

  it('serves the community instructions', () => {
    const { COMMUNITY_MCP_EDITION_TEXTS } =
      require('./community/mcp-edition-texts.community') as {
        COMMUNITY_MCP_EDITION_TEXTS: McpEditionTexts;
      };
    expect(booted.moduleRef.get(MCP_EDITION_TEXTS)).toEqual(
      COMMUNITY_MCP_EDITION_TEXTS,
    );
  });

  it('names the six import types and the image option', () => {
    const { COMMUNITY_MCP_EDITION_TEXTS } =
      require('./community/mcp-edition-texts.community') as {
        COMMUNITY_MCP_EDITION_TEXTS: McpEditionTexts;
      };
    expect(COMMUNITY_MCP_EDITION_TEXTS.noScanYetNextStep).toContain(
      '--type <sast|iac|secret|cicd|sca|container>',
    );
    expect(COMMUNITY_MCP_EDITION_TEXTS.noScanYetNextStep).toContain(
      '--image <ref>',
    );
  });
});
