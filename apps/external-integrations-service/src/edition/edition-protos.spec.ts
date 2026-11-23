// ee-modules loads EE_FEATURE_MODULES — RepositoryHistoryModule pulls in
// GithubModule/GitlabModule and their ESM-only octokit packages. Mock them
// exactly as community-boot.spec.ts does so the modules load under jest.
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

import { EE_PROTO_PATHS } from './ee-modules';
import { editionProtoPaths } from './edition-protos';

/**
 * editionProtoPaths() is the reader of EE_PROTO_PATHS that main.ts
 * spreads after CORE_GRPC_PROTO_PATHS. The edition is read at each call, so
 * each test sets CYBEDEFEND_EDITION itself and restores the environment
 * after.
 */
describe('editionProtoPaths', () => {
  const savedEnv = process.env;

  afterEach(() => {
    process.env = savedEnv;
  });

  it('community loads only the core protos', () => {
    process.env = { ...savedEnv, CYBEDEFEND_EDITION: 'community' };

    expect(editionProtoPaths()).toEqual([]);
  });

  it('cloud adds the closed protos', () => {
    const env = { ...savedEnv };
    delete env.CYBEDEFEND_EDITION;
    process.env = env;

    expect(editionProtoPaths()).toEqual(EE_PROTO_PATHS);
  });
});
