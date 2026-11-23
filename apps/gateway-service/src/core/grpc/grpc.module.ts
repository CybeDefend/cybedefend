// grpc.module.ts
import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { resolveProtoBasePath } from './proto-base-path';
import { serviceAuthClientChannelOptions } from '../service-auth/service-auth.edition';
import { grpcClientChannelCredentials } from '../service-auth/grpc-channel-credentials';

export interface GrpcClientConfig {
  name: string;
  protoPackage: string;
  protoPath: string | string[];
  envUrl: string;
  defaultUrl: string;
  /** False for a server reached without Envoy that refuses keepalive pings. */
  keepWarm?: boolean;
}

/**
 * Only the core clients. The closed ones (billing, agent, mcp and the closed
 * global-management protos) are registered by the cloud edition, so the core
 * loads no closed proto.
 */
export const CORE_GRPC_CLIENTS: readonly GrpcClientConfig[] = [
  {
    name: 'ANALYSIS_REPORTING_SERVICE',
    protoPackage: 'cybedefend.analysis_reporting',
    protoPath: 'analysis-reporting/analysis_reporting.proto',
    envUrl: 'GRPC_URL_ANALYSIS_REPORTING_SERVICE',
    defaultUrl: 'localhost:50054',
  },
  {
    name: 'SECURITY_SCANNING_SERVICE',
    protoPackage: 'cybedefend.security_scanning',
    protoPath: 'security-scanning/security_scanning.proto',
    envUrl: 'GRPC_URL_SECURITY_SCANNING_SERVICE',
    defaultUrl: 'localhost:50055',
  },
  {
    name: 'EXTERNAL_INTEGRATIONS_SERVICE',
    protoPackage: 'cybedefend.external_integrations',
    // The container registry protos are closed: the cloud edition loads
    // them on a client of its own, never this core client.
    protoPath: ['external-integrations/external_integrations.proto'],
    envUrl: 'GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE',
    defaultUrl: 'localhost:50057',
  },
  {
    name: 'GLOBAL_MANAGEMENT_SERVICE',
    protoPackage: 'cybedefend.global_management',
    // local_auth.proto rides the core GM client, so the community
    // JWKS source can call LocalAuthService (GetJwks, VerifyPersonalAccessToken).
    protoPath: [
      'global-management/global_management.proto',
      'global-management/local_auth.proto',
    ],
    envUrl: 'GRPC_URL_GLOBAL_MANAGEMENT_SERVICE',
    defaultUrl: 'localhost:50052',
  },
  {
    name: 'FILE_MANAGEMENT_SERVICE',
    protoPackage: 'cybedefend.file_management',
    protoPath: 'file-management/file_management.proto',
    envUrl: 'GRPC_URL_FILE_MANAGEMENT_SERVICE',
    defaultUrl: 'localhost:50051',
  },
  {
    name: 'POLICY_MANAGEMENT_SERVICE',
    protoPackage: 'cybedefend.policy_management',
    protoPath: 'policy-management/policy_management.proto',
    envUrl: 'GRPC_URL_POLICY_MANAGEMENT_SERVICE',
    defaultUrl: 'localhost:50060',
  },
];

/**
 * The one `ClientsModule.registerAsync` mapping, shared so the cloud edition
 * registers its clients with exactly the same options.
 */
export function buildGrpcClientModules(
  clients: readonly GrpcClientConfig[],
): DynamicModule[] {
  // Modules holding the dynamic providers
  return clients.map((client) =>
    ClientsModule.registerAsync([
      {
        name: client.name,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => {
          const protoBasePath = resolveProtoBasePath({
            nodeEnv: config.get<string>('NODE_ENV'),
            override: config.get<string>('PROTO_BASE_PATH'),
            devPath: join(process.cwd(), '../../libs/protos'),
          });

          // Handle both single path and array of paths
          const protoPath = Array.isArray(client.protoPath)
            ? client.protoPath.map((p) => join(protoBasePath, p))
            : join(protoBasePath, client.protoPath);

          return {
            transport: Transport.GRPC,
            options: {
              package: client.protoPackage,
              credentials: grpcClientChannelCredentials(client.protoPackage),
              protoPath,
              url: config.get<string>(client.envUrl, client.defaultUrl),
              channelOptions: {
                ...serviceAuthClientChannelOptions(),
                'grpc.max_send_message_length': 50 * 1024 * 1024, // 50MB
                'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB
                ...(client.keepWarm === false
                  ? {}
                  : GRPC_KEEPALIVE_CHANNEL_OPTIONS),
              },
              loader: {
                ...GRPC_LOADER_OPTIONS,
                includeDirs: [protoBasePath],
              },
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
  );
}

/**
 * How every gateway gRPC client decodes messages.
 * `oneofs: false`: with `true`, each set proto3 `optional` field added a
 * `"_field": "field"` key to the JSON the gateway returns, and a real oneof
 * its member name (`vulnerability: 'sast'`). No client reads them.
 */
export const GRPC_LOADER_OPTIONS = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: false,
} as const;

/**
 * Keeps a channel to Envoy connected between calls. grpc-js puts a channel to
 * sleep after 30 min without a call, and a proxy may close an idle connection,
 * so the first call after a quiet spell would pay a new connection. The
 * channel idles after
 * a day (the most a 32-bit timer holds is ~24.8 days), and pings every 30 s,
 * between calls too, so a dead peer is noticed and nothing on the path drops
 * the connection as idle. Envoy answers pings without limit; its own idle
 * timeout, which pings do not reset, is expected to be a day too. A
 * grpc-js server enforces no ping policy either, which covers the targets
 * reached without Envoy: mcp-service, and policy-management for a deployment
 * whose URLs are headless (`*-headless:50060` is its app port, no sidecar).
 *
 * Not for the Python agent service, reached directly: its gRPC server keeps
 * C-core's ping policy (one ping per 5 min without data, none between calls)
 * and closes a connection pinged every 30 s with GOAWAY too_many_pings.
 */
export const GRPC_KEEPALIVE_CHANNEL_OPTIONS = {
  'grpc.keepalive_time_ms': 30_000,
  'grpc.keepalive_permit_without_calls': 1,
  'grpc.client_idle_timeout_ms': 24 * 60 * 60 * 1000,
} as const;

/** The one module register() returns; see GrpcModule.register(). */
let registered: DynamicModule | undefined;

@Module({})
export class GrpcModule {
  /**
   * The same DynamicModule on every call. Many modules import it, and a new
   * build per call would create new client modules each time, each parsing
   * its .proto files. Nest deduplicates a dynamic module by reference, so the
   * core clients exist once per process.
   */
  static register(): DynamicModule {
    registered ??= GrpcModule.build();
    return registered;
  }

  private static build(): DynamicModule {
    const grpcClientModules = buildGrpcClientModules(CORE_GRPC_CLIENTS);

    return {
      module: GrpcModule,
      // Global, so a port binding can inject a gRPC client from any
      // module without importing GrpcModule there.
      global: true,
      imports: [ConfigModule, ...grpcClientModules],
      exports: grpcClientModules,
    };
  }
}
