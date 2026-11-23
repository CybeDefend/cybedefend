import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';
import { serverProtoPaths } from './server-proto-paths';

/**
 * `analysis_reporting.proto` no longer imports the MCP protos, so the
 * closed `McpVerifyService` / `McpInventoryService` reach the wire only
 * through `EE_PROTO_PATHS` (cloud), never in the Community Edition. A mocked
 * unit test would not notice a service missing from the server, so this loads
 * the real proto files through the real loader.
 */
describe('serverProtoPaths', () => {
  const KEY = 'CYBEDEFEND_EDITION';
  let saved: string | undefined;

  const protoBasePath = join(__dirname, '../../../../../libs/protos');

  // Same options as src/main.ts.
  const loaderOptions = {
    includeDirs: [protoBasePath],
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  };

  beforeEach(() => {
    saved = process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = saved;
    }
  });

  it('loads no MCP service in community', () => {
    process.env[KEY] = 'community';
    const def = loadSync(serverProtoPaths(protoBasePath), loaderOptions);

    expect(
      def['cybedefend.analysis_reporting.McpInventoryService'],
    ).toBeUndefined();
    expect(
      def['cybedefend.analysis_reporting.McpVerifyService'],
    ).toBeUndefined();
  });


  // 'loads the MCP services in the cloud' is in the closed extension.

  it('always loads the exported contract and health, joined to the base path', () => {
    process.env[KEY] = 'community';
    expect(serverProtoPaths(protoBasePath)).toEqual([
      join(protoBasePath, 'analysis-reporting/analysis_reporting.proto'),
      join(protoBasePath, 'health/health.proto'),
    ]);
  });
});
