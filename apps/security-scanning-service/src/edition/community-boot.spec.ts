import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';

/**
 * security-scanning's whole dependency graph in community mode, resolved the
 * way NestFactory resolves it at bootstrap, without instantiating anything
 * (`preview: true`: no database connection, no gRPC client, no secret-store
 * call). CYBEDEFEND_EDITION is set in beforeAll, before any dynamic import of
 * a module, because editionImports() runs when the @Module decorator is
 * evaluated, i.e. at import time.
 */

// What AppModule's Joi schema requires in community mode. Placeholders:
// nothing connects. No DB_TYPE / DB_HOST / DB_PORT / MYSQL_* key on purpose:
// the specs compile in preview mode and open no connection; a
// DB_TYPE=postgres variant of this spec spreads the same BOOT_ENV.
// No KUBERNETES_ENV / GRPC_URL_AGENT_SERVICE / ALLOWED_SCAN_IPS (nor
// the KUBERNETES_ENV-dependent SCAN_IMAGE_REGISTRY) either — those belong to
// the closed scanner-pod, agent and scan-IP code, so the
// schema does not require them when CYBEDEFEND_EDITION=community.
const BOOT_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  GRPC_URL_GLOBAL_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GRPC_URL_SECURITY_SCANNING_SERVICE: '127.0.0.1:1',
  GRPC_URL_FILE_MANAGEMENT_SERVICE: '127.0.0.1:1',
  GCR_NAME: 'gcr.invalid',
  GCP_BUCKET_NAME: 'bucket',
  OTEL_DISABLED: 'true',
  CYBEDEFEND_EDITION: 'community',
};

const CONTEXTS: Array<[string, () => Promise<Record<string, unknown>>]> = [
  ['AppModule', () => import('../app.module')],
  ['CronAppModule', () => import('../cron.app.module')],
];

interface ModuleInGraph {
  metatype: { name: string } | Type<unknown>;
  isGlobal: boolean;
  providers: Map<unknown, unknown>;
}

// The closed classes and clients the core must never provide in
// community mode — KubernetesService, the closed AI analysis, the closed
// writable gate, the scan cron, and the AGENT_SERVICE / BILLING_SERVICE /
// MARKETING_LEAD_SERVICE gRPC clients.
const CLOSED_PROVIDER_NAMES = [
  'KubernetesService',
  'CloudAiAnalysis',
  'BillingWritableService',
  'ScanCron',
  'AGENT_SERVICE',
  'BILLING_SERVICE',
  'MARKETING_LEAD_SERVICE',
];

describe.each(CONTEXTS)('%s in community mode', (name, load) => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('resolves every dependency and loads no ee module', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const { EE_MODULES, EE_CONTEXT_MODULES } = await import('./ee-modules');
    const { currentEdition } = await import('./edition');
    const { editionModuleClass } = await import('./edition-imports');
    expect(currentEdition()).toBe('community');
    const app = await Test.createTestingModule({ imports: [mod] }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const modules = [...container.getModules().values()];
    expect(
      modules.some(
        (m) =>
          (m.metatype as { name: string }).name === 'EditionModule' &&
          m.isGlobal,
      ),
    ).toBe(true);
    const ee = new Set(
      [...EE_MODULES, ...Object.values(EE_CONTEXT_MODULES).flat()].map(
        editionModuleClass,
      ),
    );
    expect(
      modules
        .filter((m) => ee.has(m.metatype as Type<unknown>))
        .map((m) => (m.metatype as { name: string }).name),
    ).toEqual([]);
  }, 120_000);

  it('loads no Kubernetes, agent or closed entitlements provider', async () => {
    const mod = (await load())[name] as Type<unknown>;
    const app = await Test.createTestingModule({ imports: [mod] }).compile({
      preview: true,
    });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const providerNames = new Set<string>();
    for (const m of container.getModules().values()) {
      for (const token of m.providers.keys()) {
        providerNames.add(
          typeof token === 'function' ? token.name : String(token),
        );
      }
    }
    // The graph really was scanned: the community port bindings of
    // EditionModule are in it.
    expect(providerNames.has('SCAN_LIFECYCLE_HOOKS')).toBe(true);
    expect(
      [...providerNames].filter((n) => CLOSED_PROVIDER_NAMES.includes(n)),
    ).toEqual([]);
  }, 120_000);
});

// The cron context runs in the Community compose for the import
// watchdog — an import analysis-reporting never completes would otherwise
// stay `running` for ever, a never-uploaded one `waiting_for_file`. The
// watchdog is a core provider of ScanModule, so CronAppModule resolves it;
// the closed ScanCron stays out in community mode.
describe('CronAppModule import watchdog in community mode', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('runs the import watchdog in the community cron context, with no closed cron', async () => {
    const { CronAppModule } = await import('../cron.app.module');
    const app = await Test.createTestingModule({
      imports: [CronAppModule],
    }).compile({ preview: true });
    const { container } = app as unknown as {
      container: { getModules(): Map<string, ModuleInGraph> };
    };
    const providerNames = new Set<string>();
    for (const m of container.getModules().values()) {
      for (const token of m.providers.keys()) {
        providerNames.add(
          typeof token === 'function' ? token.name : String(token),
        );
      }
    }
    // The watchdog resolves in the community cron context (its whole
    // dependency graph compiled above); the closed scan cron does not.
    expect(providerNames.has('ImportScanWatchdog')).toBe(true);
    expect(providerNames.has('ScanCron')).toBe(false);
  }, 120_000);
});

// The Community API context serves ClusterScanService
// from the Community-only ClusterScanningModule. With no CYBEDEFEND_SCANNER_*
// configuration it resolves import-only (no Kubernetes client).
describe('AppModule cluster engine in community mode', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('loads ClusterScanningModule, its state and the ClusterScanService controllers', async () => {
    const { AppModule } = await import('../app.module');
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile({ preview: true });
    const { container } = app as unknown as {
      container: {
        getModules(): Map<
          string,
          ModuleInGraph & { controllers: Map<unknown, unknown> }
        >;
      };
    };
    const modules = [...container.getModules().values()];
    const engine = modules.find(
      (m) => (m.metatype as { name: string }).name === 'ClusterScanningModule',
    );
    expect(engine).toBeDefined();
    expect(engine.isGlobal).toBe(true);
    const controllerNames = [...engine.controllers.keys()].map(
      (t) => (t as { name: string }).name,
    );
    expect(controllerNames).toEqual(
      expect.arrayContaining([
        'ScanCapabilitiesController',
        'ScanResultsController',
      ]),
    );
    const providerNames = [...engine.providers.keys()].map((t) =>
      typeof t === 'function' ? t.name : String(t),
    );
    expect(providerNames).toEqual(
      expect.arrayContaining([
        'ClusterScanningState',
        'CLUSTER_SCANNING_CONFIG',
        'COMMUNITY_KUBE_CLIENT',
      ]),
    );
  }, 120_000);
});

// The engine's orchestrator and queue tick resolve
// in both Community contexts, with and without a CYBEDEFEND_SCANNER_*
// configuration. The cron process (CronAppModule = AppModule +
// ScheduleModule) holds exactly one ClusterScanningModule: the 15 s tick and
// the watchdog fire there only.
const CLUSTER_ENV: Record<string, string> = {
  CYBEDEFEND_SCANNER_KUBECONFIG_FILE: '/run/cybedefend/kubeconfig',
  CYBEDEFEND_SCANNER_NAMESPACE: 'cybedefend-scans',
  FRONTEND_URL: 'https://appsec.example.com',
};

describe.each([
  ['without a cluster configuration', {}],
  ['with a cluster configuration', CLUSTER_ENV],
])('the cluster engine in community mode, %s', (_label, extraEnv) => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV, ...extraEnv };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it.each(CONTEXTS)(
    '%s compiles, with one ClusterScanningModule holding the orchestrator and the queue',
    async (name, load) => {
      const mod = (await load())[name] as Type<unknown>;
      const app = await Test.createTestingModule({ imports: [mod] }).compile({
        preview: true,
      });
      const { container } = app as unknown as {
        container: { getModules(): Map<string, ModuleInGraph> };
      };
      const engines = [...container.getModules().values()].filter(
        (m) =>
          (m.metatype as { name: string }).name === 'ClusterScanningModule',
      );
      expect(engines).toHaveLength(1);
      const providerNames = [...engines[0].providers.keys()].map((t) =>
        typeof t === 'function' ? t.name : String(t),
      );
      expect(providerNames).toEqual(
        expect.arrayContaining([
          'CommunityScannerCatalogue',
          'ClusterPodLauncher',
          'ClusterScannerOrchestrator',
          'ClusterScanQueue',
          'ClusterPodWatchdog',
        ]),
      );
      // The results route, its tokens and its
      // controller live in ClusterScanningModule alone, once
      const all = [...container.getModules().values()];
      for (const name of ['ScanResultsService', 'ScanUploadTokens']) {
        const holders = all.filter((m) =>
          [...m.providers.keys()].some(
            (t) => typeof t === 'function' && t.name === name,
          ),
        );
        expect(
          holders.map((m) => (m.metatype as { name: string }).name),
        ).toEqual(['ClusterScanningModule']);
      }
      const resultControllers = all.flatMap((m) =>
        [
          ...((
            m as { controllers?: Map<unknown, unknown> }
          ).controllers?.keys() ?? []),
        ].filter(
          (t) => (t as { name: string }).name === 'ScanResultsController',
        ),
      );
      expect(resultControllers).toHaveLength(1);
    },
    120_000,
  );
});

// The global EditionModule's Community facade resolves the
// engine a global module exports (@Optional), and delegates to it while
// enabled — not a mock of the facade.
describe('the Community scanner-orchestrator facade resolves the engine', () => {
  const savedEnv = process.env;

  beforeAll(() => {
    process.env = { ...savedEnv, ...BOOT_ENV };
  }, 120_000);

  afterAll(() => {
    process.env = savedEnv;
  });

  it('SCANNER_ORCHESTRATOR_PORT delegates to the global ClusterScannerOrchestrator', async () => {
    const { Global, Module } = await import('@nestjs/common');
    const { EditionModule } = await import('./edition.module');
    const { SCANNER_ORCHESTRATOR_PORT } =
      await import('./ports/scanner-orchestrator.port');
    const { ClusterScannerOrchestrator } =
      await import('../modules/cluster-scanning/cluster-scanner-orchestrator');
    const { ClusterScanningState } =
      await import('../modules/cluster-scanning/cluster-scanning.state');
    const assertScanSupported = jest.fn();
    @Global()
    @Module({
      providers: [
        {
          provide: ClusterScannerOrchestrator,
          useValue: { assertScanSupported },
        },
        { provide: ClusterScanningState, useValue: { enabled: true } },
      ],
      exports: [ClusterScannerOrchestrator, ClusterScanningState],
    })
    class EngineStub {}
    const app = await Test.createTestingModule({
      imports: [EditionModule.forRoot(), EngineStub],
    }).compile();
    const port = app.get<{ assertScanSupported(r: unknown): void }>(
      SCANNER_ORCHESTRATOR_PORT,
    );
    const request = { scanId: 's' };
    port.assertScanSupported(request);
    expect(assertScanSupported).toHaveBeenCalledWith(request);
    await app.close();
  }, 120_000);
});

// ScanResultsService is registered in the global
// ClusterScanningModule only, which imports ScanModule. ImportScanService
// (ScanModule) still resolves it @Optional() through the global scope, the
// same shape as the real graph — so a container's end of import is not
// silently refused in Community.
describe('ImportScanService resolves the global ScanResultsService', () => {
  it('a module imported by a global module gets its @Optional() export', async () => {
    const { Global, Module } = await import('@nestjs/common');
    const { getRepositoryToken } = await import('@nestjs/typeorm');
    const { Logger } = await import('nestjs-pino');
    const { ImportScanService } =
      await import('../modules/scan/import/import-scan.service');
    const { ScanResultsService } =
      await import('../modules/scan/cluster-results/scan-results.service');
    const { ScanStateStore } =
      await import('../modules/scan/core/scanStateStore');
    const { ScanStateManager } =
      await import('../modules/scan/core/scanStateManager');
    const { ProjectAppsecMarker } =
      await import('../modules/scan/core/projectAppsecMarker');
    const { FileManagementService } =
      await import('../modules/file/file-management.service');
    const { ENTITLEMENTS_PORT } = await import('./ports/entitlements.port');
    const { Scan } = await import('../entities/scan.entity');

    @Module({
      providers: [
        ImportScanService,
        { provide: getRepositoryToken(Scan), useValue: {} },
        { provide: ScanStateStore, useValue: {} },
        { provide: ScanStateManager, useValue: {} },
        { provide: ProjectAppsecMarker, useValue: {} },
        { provide: FileManagementService, useValue: {} },
        { provide: ENTITLEMENTS_PORT, useValue: {} },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: Logger, useValue: {} },
      ],
      exports: [ImportScanService],
    })
    class ScanModuleShape {}

    const closeContainer = jest.fn(async () => ({
      success: true,
      message: 'Container completed',
    }));
    @Global()
    @Module({
      imports: [ScanModuleShape],
      providers: [
        { provide: ScanResultsService, useValue: { closeContainer } },
      ],
      exports: [ScanResultsService],
    })
    class ClusterScanningModuleShape {}

    const app = await Test.createTestingModule({
      imports: [ClusterScanningModuleShape],
    }).compile();
    const request = {
      scanId: '11111111-1111-4111-8111-111111111111',
      containerId: '22222222-2222-4222-8222-222222222222',
      status: 'completed',
      errorCode: '',
      findingsCount: 1,
      toolName: 'zizmor',
    };
    await expect(app.get(ImportScanService).complete(request)).resolves.toEqual(
      { success: true, message: 'Container completed' },
    );
    expect(closeContainer).toHaveBeenCalledWith(request);
    await app.close();
  }, 120_000);
});
