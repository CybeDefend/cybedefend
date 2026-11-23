// editionProtoPaths() reads edition/ee-modules, which now loads
// EE_FEATURE_MODULES — RepositoryHistoryModule pulls in GithubModule/
// GitlabModule and their ESM-only octokit packages. Mock them exactly as
// community-boot.spec.ts does so the modules load under jest.
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

import { join } from 'node:path';
import { editionProtoPaths } from './edition/edition-protos';
import { CORE_GRPC_PROTO_PATHS, grpcPackagesOf } from './grpc-proto-paths';

const PROTOS = join(__dirname, '../../../libs/protos');
const files = (paths: readonly string[]) => paths.map((p) => join(PROTOS, p));

/**
 * main.ts loads [...CORE_GRPC_PROTO_PATHS, ...editionProtoPaths()].
 * The core list must carry every proto the exported (community) tree still
 * ships, and no closed one: crm-sync/crm_sync.proto and
 * external-integrations/repository_history.proto are loaded in cloud mode
 * only, through EE_PROTO_PATHS — in the exported tree those files do not
 * exist and a core reference to them kills the process at start.
 */
describe('CORE_GRPC_PROTO_PATHS', () => {
  it('loads no closed proto in the core list', () => {
    expect(
      CORE_GRPC_PROTO_PATHS.filter(
        (p) => p.startsWith('crm-sync/') || p.includes('repository_history'),
      ),
    ).toEqual([]);
  });

  it('keeps every exported proto main.ts loaded', () => {
    expect(CORE_GRPC_PROTO_PATHS).toContain(
      'external-integrations/external_integrations.proto',
    );
    expect(CORE_GRPC_PROTO_PATHS).toContain('health/health.proto');
  });
});

/**
 * The repository history server belongs to the closed edition
 * and its proto is stripped whole at export, so main.ts may load
 * external-integrations/repository_history.proto in cloud mode only, through
 * editionProtoPaths().
 */
describe('the repository history proto loads in cloud mode only', () => {
  const KEY = 'CYBEDEFEND_EDITION';
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('community loads no repository history proto', () => {
    process.env[KEY] = 'community';
    expect(editionProtoPaths()).not.toContain(
      'external-integrations/repository_history.proto',
    );
  });

  // 'cloud loads the repository history proto' is tested in the closed
  // edition.
});

/**
 * Nest's gRPC server throws InvalidGrpcPackageException at start for a
 * `package` option that no loaded proto declares, so the package list must
 * follow the proto list of the running edition: main.ts derives it.
 */
describe('grpcPackagesOf', () => {
  const KEY = 'CYBEDEFEND_EDITION';
  const saved = process.env[KEY];
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('declares each package of the core protos once, in load order', () => {
    expect(grpcPackagesOf(files(CORE_GRPC_PROTO_PATHS))).toEqual([
      'cybedefend.external_integrations',
      'grpc.health.v1',
    ]);
  });

  it('declares no package the community protos lack', () => {
    process.env[KEY] = 'community';
    expect(
      grpcPackagesOf(files([...CORE_GRPC_PROTO_PATHS, ...editionProtoPaths()])),
    ).toEqual(['cybedefend.external_integrations', 'grpc.health.v1']);
  });

  // 'adds the package of every closed proto in the cloud' is tested in the
  // closed edition.
});
