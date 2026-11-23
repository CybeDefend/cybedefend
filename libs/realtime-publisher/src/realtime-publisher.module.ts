import {
  DynamicModule,
  Inject,
  Module,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { RealtimeEventPublisher } from './realtime-event.publisher';

export interface RealtimePublisherOptions {
  realtimeRedisUrl: string;
  channelPrefix?: string;
  streamPrefix?: string;
  streamMaxLen?: number;
  burst?: number;
  refillPerSecond?: number;
}

/** The part of the ioredis client that closing it needs. */
interface RedisToClose {
  readonly status?: string;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

/** How long QUIT may wait for Redis before the socket is dropped. */
const CLOSE_TIMEOUT_MS = 2_000;
const CLOSE_TIMEOUT = 'REALTIME_REDIS_PUB_CLOSE_TIMEOUT_MS';

@Module({})
export class RealtimePublisherModule implements OnApplicationShutdown {
  constructor(
    @Inject('REALTIME_REDIS_PUB') private readonly redis: RedisToClose,
    @Optional()
    @Inject(CLOSE_TIMEOUT)
    private readonly closeTimeoutMs: number = CLOSE_TIMEOUT_MS,
  ) {}

  /**
   * The client comes from a factory provider, on which Nest runs no
   * lifecycle hook: left open, its socket kept the process alive after
   * app.close(), so a SIGTERM never ended it. QUIT, and drop the socket when
   * QUIT fails or takes longer than the bound; never throws.
   */
  async onApplicationShutdown(): Promise<void> {
    const client = this.redis;
    if (!client || client.status === 'end') return;
    const drop = (): void => {
      try {
        client.disconnect?.();
      } catch {
        // Shutdown goes on.
      }
    };
    if (typeof client.quit !== 'function') {
      drop();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.closeTimeoutMs ?? CLOSE_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([client.quit().then(() => 'quit' as const), timedOut]);
      if (outcome === 'timeout') drop();
    } catch {
      drop();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  static forRoot(options: RealtimePublisherOptions): DynamicModule {
    return {
      module: RealtimePublisherModule,
      providers: [
        { provide: 'REALTIME_REDIS_PUB', useFactory: () => new Redis(options.realtimeRedisUrl) },
        { provide: 'REALTIME_OPTIONS', useValue: options },
        RealtimeEventPublisher,
      ],
      exports: [RealtimeEventPublisher],
      global: true,
    };
  }
}
