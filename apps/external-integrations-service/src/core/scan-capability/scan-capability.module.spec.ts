import { Test } from '@nestjs/testing';
import type { DynamicModule, Type } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import {
  COMMUNITY_CONTEXT_MODULES,
  COMMUNITY_ONLY_MODULES,
} from '../../edition/community-bindings';
import { CommunityEntitlements } from '../../edition/community/entitlements.community';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../../edition/ports/entitlements.port';
import { ScanCapabilityCache } from './scan-capability.cache';
import { ScanCapabilityModule } from './scan-capability.module';

// The edition layer loads the ee module lists, which import GithubService and
// its ESM-only octokit packages: mocked as community-boot.spec.ts does.
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }));
const MockOctokit = jest
  .fn()
  .mockImplementation(() => ({ request: jest.fn() }));
(MockOctokit as unknown as { plugin: jest.Mock }).plugin = jest
  .fn()
  .mockReturnValue(MockOctokit);
jest.mock('@octokit/rest', () => ({ Octokit: MockOctokit }));
jest.mock('@octokit/plugin-retry', () => ({ retry: jest.fn() }));
jest.mock('@octokit/plugin-throttling', () => ({ throttling: jest.fn() }));

function clusterClient(clusterScans: boolean): ClientGrpc {
  return {
    getService: () => ({
      getScanCapabilities: () => of({ clusterScans }),
    }),
  } as unknown as ClientGrpc;
}

interface Loaded {
  editionModule: DynamicModule;
  ScanCapabilityModule: Type<unknown>;
  workerImports: Array<Type<unknown> | DynamicModule>;
}

/**
 * The real EditionModule.forRoot() of the Community Edition. forRoot() is
 * memoised and editionBindings() reads CYBEDEFEND_EDITION, so the modules are
 * loaded in an isolated registry with the edition set.
 */
async function loadCommunity(): Promise<Loaded> {
  const saved = process.env.CYBEDEFEND_EDITION;
  process.env.CYBEDEFEND_EDITION = 'community';
  let loaded: Loaded | undefined;
  try {
    await jest.isolateModulesAsync(async () => {
      const edition = await import('../../edition/edition.module');
      const scan = await import('./scan-capability.module');
      const imports = await import('../../edition/edition-imports');
      loaded = {
        editionModule: edition.EditionModule.forRoot(),
        ScanCapabilityModule: scan.ScanCapabilityModule,
        workerImports: imports.editionImportsFor('worker'),
      };
    });
  } finally {
    if (saved === undefined) {
      delete process.env.CYBEDEFEND_EDITION;
    } else {
      process.env.CYBEDEFEND_EDITION = saved;
    }
  }
  return loaded as Loaded;
}

async function decisionsThrough(
  imports: Array<Type<unknown> | DynamicModule>,
  clusterScans: boolean,
): Promise<{ push: unknown; link: unknown }> {
  const moduleRef = await Test.createTestingModule({ imports })
    .overrideProvider('SECURITY_SCANNING_SERVICE')
    .useValue(clusterClient(clusterScans))
    .compile();
  await moduleRef.init();
  try {
    const entitlements = moduleRef.get<EntitlementsPort>(ENTITLEMENTS_PORT);
    return {
      push: await entitlements.decidePushScan('org-1', true),
      link: entitlements.decideLinkScan('appsec'),
    };
  } finally {
    await moduleRef.close();
  }
}

describe('ScanCapabilityModule', () => {
  it('is a Community-only module of the API and worker contexts, never of the cron one', () => {
    expect(COMMUNITY_ONLY_MODULES).toContain(ScanCapabilityModule);
    expect(COMMUNITY_CONTEXT_MODULES.worker).toContain(ScanCapabilityModule);
    expect(COMMUNITY_CONTEXT_MODULES['cron-webhook'] ?? []).not.toContain(
      ScanCapabilityModule,
    );
  });

  it('hands its cache to CommunityEntitlements, which then lets a push and a link scan', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ScanCapabilityModule],
      providers: [
        { provide: ENTITLEMENTS_PORT, useClass: CommunityEntitlements },
      ],
    })
      .overrideProvider('SECURITY_SCANNING_SERVICE')
      .useValue(clusterClient(true))
      .compile();
    await moduleRef.init();
    try {
      expect(moduleRef.get(ScanCapabilityCache).current()).toBe(true);
      const entitlements = moduleRef.get<EntitlementsPort>(ENTITLEMENTS_PORT);
      expect(await entitlements.decidePushScan('org-1', true)).toEqual({
        scan: 'appsec',
      });
      expect(entitlements.decideLinkScan('appsec')).toEqual({ scan: 'appsec' });
    } finally {
      await moduleRef.close();
    }
  });

  it('reaches the CommunityEntitlements of the real EditionModule through the global module', async () => {
    const community = await loadCommunity();
    const withCluster = await decisionsThrough(
      [community.editionModule, community.ScanCapabilityModule],
      true,
    );
    expect(withCluster).toEqual({
      push: { scan: 'appsec' },
      link: { scan: 'appsec' },
    });
    const withoutCluster = await decisionsThrough(
      [community.editionModule, community.ScanCapabilityModule],
      false,
    );
    expect(withoutCluster).toEqual({
      push: { scan: 'none', reason: 'community_edition' },
      link: { scan: 'none', reason: 'community_edition' },
    });
  });

  it('decides a deferred rescan of the worker context appsec when a cluster runs scans', async () => {
    // What WorkerModule (where PendingRescanConsumer runs) imports in the
    // Community Edition: EditionModule.forRoot() and editionImportsFor('worker').
    const community = await loadCommunity();
    const { workerImports } = community;
    expect(
      workerImports.some((m) => m === community.ScanCapabilityModule),
    ).toBe(true);
    const { push } = await decisionsThrough(
      [community.editionModule, ...workerImports],
      true,
    );
    expect(push).toEqual({ scan: 'appsec' });
  });
});
