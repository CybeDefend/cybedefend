import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';

import {
  CORE_GRPC_CLIENTS,
  GRPC_KEEPALIVE_CHANNEL_OPTIONS,
  GRPC_LOADER_OPTIONS,
  GrpcModule,
} from './grpc.module';

interface RpcCodec {
  responseSerialize: (value: object) => Buffer;
  responseDeserialize: (bytes: Buffer) => Record<string, unknown>;
}
interface LoaderOptions {
  includeDirs?: string[];
  oneofs?: boolean;
  [option: string]: unknown;
}

/** The proto-loader Nest's ClientGrpcProxy itself requires. */
const protoLoader = createRequire(
  require.resolve('@nestjs/microservices/client/client-grpc.js'),
)('@grpc/proto-loader') as {
  loadSync: (
    file: string,
    options: LoaderOptions,
  ) => Record<string, Record<string, RpcCodec>>;
};

const PROTOS = join(__dirname, '../../../../../libs/protos');

/**
 * Builds a Nest module importing GrpcModule.register() from `importers`
 * feature modules, with ClientProxyFactory.create stubbed: returns the
 * options each gRPC client was created with.
 */
async function createdClients(importers: number): Promise<
  {
    options: {
      package: string;
      loader: LoaderOptions;
      channelOptions: Record<string, unknown>;
    };
  }[]
> {
  const create = jest
    .spyOn(ClientProxyFactory, 'create')
    .mockImplementation(() => ({ close: jest.fn() }) as unknown as ClientProxy);
  const features = Array.from({ length: importers }, () => {
    @Module({ imports: [GrpcModule.register()] })
    class FeatureModule {}
    return FeatureModule;
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), ...features],
  }).compile();
  await moduleRef.close();
  return create.mock.calls.map(
    ([options]) =>
      options as unknown as {
        options: {
          package: string;
          loader: LoaderOptions;
          channelOptions: Record<string, unknown>;
        };
      },
  );
}

/**
 * 37 modules import GrpcModule.register(). Each call built nine
 * new ClientsModule dynamic modules, so the gateway created 333 gRPC client
 * proxies at boot, each parsing its .proto files (~1.7 s of CPU, ~330 MB of
 * heap retained, measured locally). Nest deduplicates a dynamic module by
 * reference, so register() returns one object and the clients exist once.
 */
describe('GrpcModule.register()', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the same module every time', () => {
    expect(GrpcModule.register()).toBe(GrpcModule.register());
  });

  it('creates each of the six core gRPC clients once, however many modules import it', async () => {
    const clients = await createdClients(3);

    expect(clients).toHaveLength(6);
    expect(new Set(clients.map(({ options }) => options.package)).size).toBe(6);
  });

  it('is global, so its clients resolve in every module', () => {
    expect(GrpcModule.register().global).toBe(true);
  });
});

/**
 * The closed clients (billing, agent, mcp, the closed MCP protos and
 * the two closed global-management protos) are registered by
 * the cloud edition's own gRPC module, never here.
 */
describe('CORE_GRPC_CLIENTS', () => {
  it('registers only the core clients', () => {
    expect(CORE_GRPC_CLIENTS.map((c) => c.name)).toEqual([
      'ANALYSIS_REPORTING_SERVICE',
      'SECURITY_SCANNING_SERVICE',
      'EXTERNAL_INTEGRATIONS_SERVICE',
      'GLOBAL_MANAGEMENT_SERVICE',
      'FILE_MANAGEMENT_SERVICE',
      'POLICY_MANAGEMENT_SERVICE',
    ]);
  });

  it('loads no closed proto file', () => {
    const closed =
      /^(billing|agent|mcp|ai|vibedefend|business-rules|security-rules|security-champion|crm-sync)\/|mcp_inventory|mcp_verify|logto_webhook|marketing_lead/;
    for (const client of CORE_GRPC_CLIENTS) {
      const paths = Array.isArray(client.protoPath)
        ? client.protoPath
        : [client.protoPath];
      for (const path of paths) {
        expect(path).not.toMatch(closed);
      }
    }
  });
});

/**
 * With `oneofs: true` every set proto3 `optional` field
 * added a `"_field": "field"` key to the JSON the gateway returns, and a real
 * oneof its name as a string (`vulnerability: 'sast'`). No client reads them.
 */
describe('the gateway proto loader options', () => {
  afterEach(() => jest.restoreAllMocks());

  it('are GRPC_LOADER_OPTIONS, without the virtual oneof keys', async () => {
    expect(GRPC_LOADER_OPTIONS.oneofs).toBe(false);
    for (const { options } of await createdClients(1)) {
      expect(options.loader).toEqual(
        expect.objectContaining(GRPC_LOADER_OPTIONS),
      );
    }
  });

  it('decode GetProjectVulnerabilityByIdResponse without any synthetic key', async () => {
    // The options the gateway's analysis-reporting client is created with.
    const [{ options }] = (await createdClients(1)).filter(
      ({ options }) => options.package === 'cybedefend.analysis_reporting',
    );
    const definition = protoLoader.loadSync(
      join(PROTOS, 'analysis-reporting/analysis_reporting.proto'),
      { ...options.loader, includeDirs: [PROTOS] },
    );
    const rpc =
      definition['cybedefend.analysis_reporting.ResultService']
        .GetSastVulnerabilityById;

    const decoded = rpc.responseDeserialize(
      rpc.responseSerialize({
        projectId: 'p1',
        vulnerabilityId: 'v1',
        sast: { base: { id: 'v1', branch: 'main' }, dataFlowItems: [] },
        isProjectParsed: true,
      }),
    );

    const syntheticKeys: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${path}[${i}]`));
      } else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key.startsWith('_')) syntheticKeys.push(`${path}.${key}`);
          walk(child, `${path}.${key}`);
        }
      }
    };
    walk(decoded, '$');

    expect(syntheticKeys).toEqual([]);
    expect(decoded).not.toHaveProperty('vulnerability');
    expect(decoded.isProjectParsed).toBe(true);
    const base = (decoded.sast as { base: Record<string, unknown> }).base;
    expect(base.id).toBe('v1');
    expect(base.branch).toBe('main'); // a set `optional` is kept…
    expect(base).not.toHaveProperty('cvss4Vector'); // …an unset one is absent
  });

  // A proto3 `optional` field of the profile decodes without the synthetic
  // `_<field>` marker UserService used to strip by hand: kept when set,
  // absent when unset.
  it("decode GetUserProfileResponse without a '_<optional field>' marker", async () => {
    const [{ options }] = (await createdClients(1)).filter(
      ({ options }) => options.package === 'cybedefend.global_management',
    );
    const definition = protoLoader.loadSync(
      join(PROTOS, 'global-management/global_management.proto'),
      { ...options.loader, includeDirs: [PROTOS] },
    );
    const rpc =
      definition['cybedefend.global_management.UserService'].GetUserProfile;

    const decoded = rpc.responseDeserialize(
      rpc.responseSerialize({
        id: 'u1',
        myOrganizations: [{ id: 'o1', memberProducts: false }, { id: 'o2' }],
      }),
    );

    const [withSwitch, withoutSwitch] = decoded.myOrganizations as Record<
      string,
      unknown
    >[];
    expect(withSwitch).not.toHaveProperty('_memberProducts');
    expect(withSwitch.memberProducts).toBe(false);
    expect(withoutSwitch).not.toHaveProperty('_memberProducts');
    expect(withoutSwitch).not.toHaveProperty('memberProducts');
  });
});

/**
 * grpc-js puts a channel to sleep after 30 min without a call
 * (`internal-channel.js`, DEFAULT_IDLE_TIMEOUT_MS) and Envoy closed an idle
 * connection after 1 h, so the first call after a quiet spell paid a new
 * connection: 150 to 450 ms on the EU pods (~110 reconnections a day on GM).
 */
describe('the gateway gRPC channels', () => {
  afterEach(() => jest.restoreAllMocks());

  // Envoy for the six core backend services: it answers pings without limit.
  it('stay warm toward Envoy: a ping every 30 s, also between calls, and a day before going idle', async () => {
    const toEnvoy = await createdClients(1);

    expect(toEnvoy).toHaveLength(6);
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

  it('keep the idle timeout inside the 32-bit timer grpc-js arms with it', () => {
    // setTimeout() fires at once past 2^31 - 1 ms: the channel would then go
    // idle right after every call.
    expect(
      GRPC_KEEPALIVE_CHANNEL_OPTIONS['grpc.client_idle_timeout_ms'],
    ).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});
