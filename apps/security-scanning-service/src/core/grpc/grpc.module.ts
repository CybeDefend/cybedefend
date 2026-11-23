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
  protoPath: string;
  envUrl: string;
  defaultUrl: string;
  /** False for a server reached without Envoy that refuses keepalive pings. */
  keepWarm?: boolean;
}

// The exported services' clients. The closed domains' clients (billing,
// marketing lead, AI agent) live in src/ee/grpc/ee-grpc-clients.module.ts:
// the Community build never loads their protos.
const grpcClients: GrpcClientConfig[] = [
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
    protoPath: 'external-integrations/external_integrations.proto',
    envUrl: 'GRPC_URL_EXTERNAL_INTEGRATIONS_SERVICE',
    defaultUrl: 'localhost:50057',
  },
  {
    name: 'GLOBAL_MANAGEMENT_SERVICE',
    protoPackage: 'cybedefend.global_management',
    protoPath: 'global-management/global_management.proto',
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
 * Keeps a channel to Envoy connected between calls. grpc-js
 * puts a channel to sleep after 30 min without a call, and Envoy closed an
 * idle connection after 1 h, so the first call after a quiet spell paid a
 * new connection: 150 to 450 ms on the EU pods. The channel now idles after
 * a day (the most a 32-bit timer holds is ~24.8 days), and pings every 30 s,
 * between calls too, so a dead peer is noticed and nothing on the path drops
 * the connection as idle. Envoy (the central gateway, or a pod's sidecar
 * behind `*-headless:50052`) answers pings without limit; its own idle
 * timeout, which pings do not reset, is a day too (chart, envoy.bats). One
 * target is reached without Envoy in headless mode: policy-management
 * (`*-headless:50060` is its app port), a grpc-js server, which enforces no
 * ping policy either.
 *
 * Not for the AI agent service, reached directly: its Python gRPC server keeps
 * C-core's ping policy (one ping per 5 min without data, none between calls)
 * and closes a connection pinged every 30 s with GOAWAY too_many_pings.
 */
export const GRPC_KEEPALIVE_CHANNEL_OPTIONS = {
  'grpc.keepalive_time_ms': 30_000,
  'grpc.keepalive_permit_without_calls': 1,
  'grpc.client_idle_timeout_ms': 24 * 60 * 60 * 1000,
} as const;

/**
 * The dynamic module registering one gRPC client: the ClientsModule
 * body of GrpcModule.register(), factored out so the closed clients of
 * src/ee/grpc/ee-grpc-clients.module.ts are registered exactly the same way.
 */
export function registerGrpcClient(client: GrpcClientConfig): DynamicModule {
  return ClientsModule.registerAsync([
    {
      name: client.name,
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const protoBasePath = resolveProtoBasePath({
          nodeEnv: config.get<string>('NODE_ENV'),
          override: config.get<string>('PROTO_BASE_PATH'),
          devPath: join(process.cwd(), '../../libs/protos'),
        });
        return {
          transport: Transport.GRPC,
          options: {
            package: client.protoPackage,
            credentials: grpcClientChannelCredentials(client.protoPackage),
            protoPath: join(protoBasePath, client.protoPath),
            url: config.get<string>(client.envUrl, client.defaultUrl),
            loader: {
              includeDirs: [protoBasePath],
              keepCase: false,
              longs: String,
              enums: String,
              defaults: true,
              oneofs: true,
            },
            channelOptions: {
              ...serviceAuthClientChannelOptions(),
              'grpc.max_send_message_length': 50 * 1024 * 1024, // 50MB
              'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB
              ...(client.keepWarm === false
                ? {}
                : GRPC_KEEPALIVE_CHANNEL_OPTIONS),
            },
          },
        };
      },
      inject: [ConfigService],
    },
  ]);
}

@Module({})
export class GrpcModule {
  static register(): DynamicModule {
    // Modules contenant les providers dynamiques
    const grpcClientModules = grpcClients.map(registerGrpcClient);

    return {
      module: GrpcModule,
      imports: [ConfigModule, ...grpcClientModules],
      exports: grpcClientModules,
    };
  }
}
