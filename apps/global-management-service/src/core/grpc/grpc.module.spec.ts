import { ConfigModule } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync, Options } from '@grpc/proto-loader';

import {
  CORE_GRPC_CLIENTS,
  GRPC_KEEPALIVE_CHANNEL_OPTIONS,
  GrpcModule,
} from './grpc.module';

interface CreatedClient {
  options: {
    package: string | string[];
    protoPath: string | string[];
    loader: Options;
    channelOptions: Record<string, unknown>;
  };
}

/**
 * The options each gRPC client of GrpcModule.register() is created with
 * (ClientProxyFactory.create is stubbed: no channel is opened).
 */
async function createdClients(): Promise<CreatedClient[]> {
  const create = jest
    .spyOn(ClientProxyFactory, 'create')
    .mockImplementation(() => ({ close: jest.fn() }) as unknown as ClientProxy);
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true }),
      GrpcModule.register(),
    ],
  }).compile();
  await moduleRef.close();
  return create.mock.calls.map(
    ([options]) => options as unknown as CreatedClient,
  );
}

/**
 * grpc-js puts a channel to sleep after 30 min without a call
 * (`internal-channel.js`, DEFAULT_IDLE_TIMEOUT_MS) and Envoy closed an idle
 * connection after 1 h, so the first call after a quiet spell paid a new
 * connection: 150 to 450 ms on the EU pods.
 */
describe('the gRPC client channels', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registers no closed client', () => {
    // The closed clients (billing, the AI agent, crm-sync) live in the closed
    // edition and are registered there, through the edition layer; the core module only knows the five core services.
    expect(CORE_GRPC_CLIENTS.map((c) => c.name)).toEqual([
      'ANALYSIS_REPORTING_SERVICE',
      'SECURITY_SCANNING_SERVICE',
      'EXTERNAL_INTEGRATIONS_SERVICE',
      'FILE_MANAGEMENT_SERVICE',
      'POLICY_MANAGEMENT_SERVICE',
    ]);
  });

  it('stay warm toward Envoy: a ping every 30 s, also between calls, and a day before going idle', async () => {
    const toEnvoy = await createdClients();

    expect(toEnvoy).toHaveLength(5);
    for (const { options } of toEnvoy) {
      expect(options.channelOptions).toEqual(
        expect.objectContaining({
          'grpc.keepalive_time_ms': 30_000,
          'grpc.keepalive_permit_without_calls': 1,
          'grpc.client_idle_timeout_ms': 24 * 60 * 60 * 1000,
          'grpc.max_send_message_length': 50 * 1024 * 1024,
          'grpc.max_receive_message_length': 50 * 1024 * 1024,
        }),
      );
    }
  });

  // The data purge calls the DataPurgeService of
  // file-management and policy-management too, through Envoy like the others.
  it('reach file-management and policy-management for the data purge', async () => {
    const clients = await createdClients();
    const packages = clients.map(({ options }) => options.package);

    expect(packages).toEqual(
      expect.arrayContaining([
        'cybedefend.file_management',
        'cybedefend.policy_management',
      ]),
    );
    for (const pkg of [
      'cybedefend.file_management',
      'cybedefend.policy_management',
    ]) {
      const client = clients.find(({ options }) => options.package === pkg)!;
      expect(client.options.channelOptions).toEqual(
        expect.objectContaining(GRPC_KEEPALIVE_CHANNEL_OPTIONS),
      );
    }
  });

  // Each purge step calls `DataPurgeService` on its client: the client's own
  // protos must load it, with the RPCs its steps call, or the runner fails
  // at startup (getService) instead of in a test.
  it.each([
    ['cybedefend.analysis_reporting', ['PurgeProjectData', 'PurgeTeamData', 'PurgeOrganizationData']],
    ['cybedefend.security_scanning', ['PurgeProjectData']],
    ['cybedefend.file_management', ['PurgeProjectData', 'PurgeTeamData', 'PurgeOrganizationData']],
    ['cybedefend.external_integrations', ['PurgeProjectData', 'PurgeOrganizationData']],
    ['cybedefend.policy_management', ['PurgeProjectData', 'PurgeTeamData', 'PurgeOrganizationData']],
  ])('the %s client loads DataPurgeService', async (pkg, rpcs) => {
    const client = (await createdClients()).find(
      ({ options }) => options.package === pkg,
    )!;
    expect(client).toBeDefined();
    const loaded = loadPackageDefinition(
      loadSync(client.options.protoPath, client.options.loader),
    ) as Record<string, unknown>;
    const service = pkg
      .split('.')
      .reduce<any>((node, key) => node?.[key], loaded)?.DataPurgeService;

    expect(service).toBeDefined();
    expect(Object.keys(service.service).sort()).toEqual([...rpcs].sort());
  });

  it('keep the idle timeout inside the 32-bit timer grpc-js arms with it', () => {
    // setTimeout() fires at once past 2^31 - 1 ms: the channel would then go
    // idle right after every call.
    expect(
      GRPC_KEEPALIVE_CHANNEL_OPTIONS['grpc.client_idle_timeout_ms'],
    ).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});
