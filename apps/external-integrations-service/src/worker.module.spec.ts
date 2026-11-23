// Loading the worker modules pulls in GithubService/GitlabService (for the DI
// param types), which import ESM-only octokit packages — mock them exactly as
// the service specs do so these module-shape assertions can load.
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

// `ConfigModule.forRoot({ validationSchema })` runs at module-DECORATION time
// and would demand the service's whole runtime environment. These
// assertions only read Nest metadata — nothing is ever bootstrapped — so the
// dynamic module is stubbed out.
jest.mock('@nestjs/config', () => {
  const actual =
    jest.requireActual<typeof import('@nestjs/config')>('@nestjs/config');
  class ConfigStubModule {}
  return {
    ...actual,
    ConfigModule: {
      ...actual.ConfigModule,
      forRoot: jest.fn(() => ({ module: ConfigStubModule })),
    },
  };
});

import 'reflect-metadata';
import { RepoScanProcessor } from './modules/repo-scan-queue/repo-scan.processor';
import { WorkerModule } from './worker.module';
import { PendingRescanConsumer } from './modules/pending-rescan/pending-rescan.consumer';
import { PendingRescanModule } from './modules/pending-rescan/pending-rescan.module';
import { GithubModule } from './modules/github/github.module';
import { GitlabModule } from './modules/gitlab/gitlab.module';
import { RepoHistoryModule } from './modules/repo-scan-queue/git-history/repo-history.module';
import { RepoHistoryService } from './modules/repo-scan-queue/git-history/repo-history.service';

type Ctor = new (...args: never[]) => unknown;

const providersOf = (moduleClass: Ctor): unknown[] =>
  (Reflect.getMetadata('providers', moduleClass) as unknown[]) ?? [];

const importsOf = (moduleClass: Ctor): unknown[] =>
  (Reflect.getMetadata('imports', moduleClass) as unknown[]) ?? [];

/**
 * Queue ownership of the repo-scan worker.
 *
 * A repository archive rewrite already uses most of the repo-scan worker's
 * memory budget, so the worker must not run a second, unrelated BullMQ
 * consumer next to it: the closed edition's CRM sync queue has its own process
 * (APP_MODE=crm-worker) and its side of that ownership is tested there.
 */
describe('WorkerModule (repo-scan worker) queue ownership', () => {
  it('consumes the repo-scan queue', () => {
    expect(providersOf(WorkerModule)).toContain(RepoScanProcessor);
  });
});

/**
 * The deferred rescans of refused pushes are recorded by the
 * webhook handlers (GithubService/GitlabService, in the API and in the
 * worker) and consumed by the repo-scan worker. Every module that builds one
 * of them must import the store's module itself: a missing provider compiles
 * and passes every unit test (the store is mocked there), then crashes the
 * process at boot with UnknownDependenciesException.
 */
describe('Deferred rescans wiring', () => {
  it('the repo-scan worker runs the consumer, with the store it needs', () => {
    expect(providersOf(WorkerModule)).toContain(PendingRescanConsumer);
    expect(importsOf(WorkerModule)).toContain(PendingRescanModule);
  });

  it.each([
    ['GithubModule', GithubModule],
    ['GitlabModule', GitlabModule],
  ])('%s imports the store module', (_name, moduleClass) => {
    expect(importsOf(moduleClass as Ctor)).toContain(PendingRescanModule);
  });
});

/**
 * The repo-scan job (GithubService/GitlabService, built in the API, the worker
 * and the one-shot tasks) fetches the scanned branch's history through
 * RepoHistoryService: each module that builds one of them imports its module.
 */
describe('Git history wiring', () => {
  it('RepoHistoryModule provides and exports the service', () => {
    expect(providersOf(RepoHistoryModule)).toContain(RepoHistoryService);
    expect(
      (Reflect.getMetadata('exports', RepoHistoryModule) as unknown[]) ?? [],
    ).toContain(RepoHistoryService);
  });

  it.each([
    ['GithubModule', GithubModule],
    ['GitlabModule', GitlabModule],
  ])('%s imports RepoHistoryModule', (_name, moduleClass) => {
    expect(importsOf(moduleClass as Ctor)).toContain(RepoHistoryModule);
  });
});
