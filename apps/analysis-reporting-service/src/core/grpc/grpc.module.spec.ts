import { ConfigModule } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';

import { GRPC_KEEPALIVE_CHANNEL_OPTIONS, GrpcModule } from './grpc.module';

interface CreatedClient {
  options: {
    package: string | string[];
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

  it('stay warm toward Envoy: a ping every 30 s, also between calls, and a day before going idle', async () => {
    // the closed AI agent and billing clients moved to the closed gRPC
    // clients module, so every client left here goes through Envoy.
    const toEnvoy = await createdClients();

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

  // The AI agent channel case moved to the closed gRPC clients module.

  it('keep the idle timeout inside the 32-bit timer grpc-js arms with it', () => {
    // setTimeout() fires at once past 2^31 - 1 ms: the channel would then go
    // idle right after every call.
    expect(
      GRPC_KEEPALIVE_CHANNEL_OPTIONS['grpc.client_idle_timeout_ms'],
    ).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});
